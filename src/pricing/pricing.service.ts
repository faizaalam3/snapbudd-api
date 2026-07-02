import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PricingService {
  private readonly serviceFee: number;
  private readonly vanMultiplier = 1.5;
  private readonly band1 = 19;
  private readonly band2 = 39;
  private readonly band3 = 80;
  private readonly mapsApiKey: string;

  constructor(private readonly config: ConfigService) {
    this.serviceFee = this.config.get<number>('platform.fixedFeeNok', 29);
    this.mapsApiKey = this.config.get<string>('googleMapsApiKey', '') ?? '';
  }

  async resolveCoordinates(
    address: string,
    fallbackLat?: number,
    fallbackLng?: number,
  ): Promise<{ lat: number; lng: number }> {
    const latFallback = fallbackLat ?? 0;
    const lngFallback = fallbackLng ?? 0;
    const query = address.trim();
    if (!query || !this.mapsApiKey) {
      return { lat: latFallback, lng: lngFallback };
    }

    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('address', query);
      url.searchParams.set('key', this.mapsApiKey);
      url.searchParams.set('language', 'en');

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return { lat: latFallback, lng: lngFallback };
      }

      const decoded = (await response.json()) as {
        status?: string;
        results?: Array<{
          geometry?: { location?: { lat?: number; lng?: number } };
        }>;
      };

      if (decoded.status !== 'OK' || !decoded.results?.length) {
        return { lat: latFallback, lng: lngFallback };
      }

      const location = decoded.results[0]?.geometry?.location;
      return {
        lat: location?.lat ?? latFallback,
        lng: location?.lng ?? lngFallback,
      };
    } catch {
      return { lat: latFallback, lng: lngFallback };
    }
  }

  haversineKm(
    pickupLat: number,
    pickupLng: number,
    dropoffLat: number,
    dropoffLng: number,
  ): number {
    if (
      (pickupLat === 0 && pickupLng === 0) ||
      (dropoffLat === 0 && dropoffLng === 0)
    ) {
      return 0;
    }

    const r = 6371;
    const dLat = ((dropoffLat - pickupLat) * Math.PI) / 180;
    const dLng = ((dropoffLng - pickupLng) * Math.PI) / 180;
    const lat1 = (pickupLat * Math.PI) / 180;
    const lat2 = (dropoffLat * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return r * c;
  }

  calculatePricing(input: {
    distanceKm: number;
    packageSize: string;
    vehicleType: string;
    discountAmount?: number;
  }) {
    const dist = input.distanceKm < 0 ? 0 : input.distanceKm;
    const size = input.packageSize.trim() || 'Medium';
    const vehicleType = input.vehicleType.trim() || 'Car';

    let base: number;
    if (dist <= this.band1) {
      base = this.bySize(size, 129, 349, 599);
    } else if (dist <= this.band2) {
      base = this.bySize(size, 195, 449, 899);
    } else if (dist <= this.band3) {
      base = this.bySize(size, 299, 599, 1299);
    } else {
      const extraKm = dist - this.band3;
      const start = this.bySize(size, 299, 599, 1299);
      const perKm = this.bySize(size, 3.5, 5.0, 8.0);
      base = start + extraKm * perKm;
    }

    const multiplier =
      vehicleType.toLowerCase() === 'van' ? this.vanMultiplier : 1;
    const subtotal = base * multiplier + this.serviceFee;
    const discount =
      input.discountAmount && input.discountAmount > 0
        ? input.discountAmount
        : 0;
    const total = Math.max(0, subtotal - discount);

    return {
      currency: 'NOK',
      base: this.round2(base),
      serviceFee: this.round2(this.serviceFee),
      vehicleMultiplier: this.round2(multiplier),
      subtotal: this.round2(subtotal),
      discount: this.round2(discount),
      total: this.round2(total),
    };
  }

  async previewRoute(input: {
    pickupAddress: string;
    dropoffAddress: string;
    packageSize: string;
    vehicleType: string;
    pickupLat?: number;
    pickupLng?: number;
    dropoffLat?: number;
    dropoffLng?: number;
    merchantLat?: number;
    merchantLng?: number;
    discountAmount?: number;
  }) {
    const pickupGeo =
      input.pickupLat != null &&
      input.pickupLng != null &&
      (input.pickupLat !== 0 || input.pickupLng !== 0)
        ? { lat: input.pickupLat, lng: input.pickupLng }
        : await this.resolveCoordinates(
            input.pickupAddress,
            input.merchantLat,
            input.merchantLng,
          );

    const dropoffGeo =
      input.dropoffLat != null &&
      input.dropoffLng != null &&
      (input.dropoffLat !== 0 || input.dropoffLng !== 0)
        ? { lat: input.dropoffLat, lng: input.dropoffLng }
        : await this.resolveCoordinates(input.dropoffAddress);

    const distanceKm = this.haversineKm(
      pickupGeo.lat,
      pickupGeo.lng,
      dropoffGeo.lat,
      dropoffGeo.lng,
    );
    const durationMin =
      distanceKm > 0 ? Math.max(8, Math.round(distanceKm / 0.55)) : 0;

    const pricing = this.calculatePricing({
      distanceKm,
      packageSize: input.packageSize,
      vehicleType: input.vehicleType,
      discountAmount: input.discountAmount,
    });

    return {
      pickup: pickupGeo,
      dropoff: dropoffGeo,
      route: {
        distanceKm: this.round2(distanceKm),
        durationMin,
      },
      pricing,
    };
  }

  private bySize(size: string, small: number, medium: number, large: number) {
    switch (size) {
      case 'Medium':
        return medium;
      case 'Large':
        return large;
      case 'Small':
      default:
        return small;
    }
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  generateDropoffPin(): string {
    const seed = Date.now() % 9000;
    return (1000 + seed).toString();
  }
}
