import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import {
  calculateDelivery,
  loadPolicy,
  DEFAULT_POLICY,
  type PricingPolicy,
} from './pricing-policy.cjs';

@Injectable()
export class PricingService {
  private readonly mapsApiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly firebase: FirebaseService,
  ) {
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

  async activePolicy(): Promise<PricingPolicy> {
    return loadPolicy(this.firebase.db);
  }

  calculatePricing(
    input: {
      distanceKm: number;
      packageSize: string;
      vehicleType: string;
      discountAmount?: number;
    },
    policy: PricingPolicy = DEFAULT_POLICY,
  ) {
    try {
      const vehicleType =
        { car: 'Car', van: 'Van', bike: 'Bike' }[
          input.vehicleType.trim().toLowerCase()
        ] || input.vehicleType;
      return calculateDelivery({ ...input, vehicleType }, policy);
    } catch {
      throw new BadRequestException(
        'Select a supported package, vehicle and valid driving distance.',
      );
    }
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

    if (
      !this.mapsApiKey ||
      !Number.isFinite(pickupGeo.lat) ||
      !Number.isFinite(pickupGeo.lng) ||
      !Number.isFinite(dropoffGeo.lat) ||
      !Number.isFinite(dropoffGeo.lng) ||
      (pickupGeo.lat === 0 && pickupGeo.lng === 0) ||
      (dropoffGeo.lat === 0 && dropoffGeo.lng === 0)
    )
      throw new BadRequestException(
        'Locate both addresses and configure delivery routing before creating an order.',
      );
    const params = new URLSearchParams({
      origin: `${pickupGeo.lat},${pickupGeo.lng}`,
      destination: `${dropoffGeo.lat},${dropoffGeo.lng}`,
      mode: 'driving',
      key: this.mapsApiKey,
    });
    let distanceKm: number, durationMin: number;
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?${params}`,
        { signal: AbortSignal.timeout(10000) },
      );
      const result = (await response.json()) as {
        status?: string;
        routes?: Array<{
          legs?: Array<{
            distance?: { value?: number };
            duration?: { value?: number };
          }>;
        }>;
      };
      const legs = result.routes?.[0]?.legs;
      if (!response.ok || result.status !== 'OK' || !legs?.length)
        throw new Error('No driving route');
      distanceKm =
        legs.reduce((sum, leg) => sum + Number(leg.distance?.value), 0) / 1000;
      durationMin =
        legs.reduce((sum, leg) => sum + Number(leg.duration?.value), 0) / 60;
      if (!Number.isFinite(durationMin) || durationMin < 0)
        throw new Error('Invalid duration');
    } catch {
      throw new BadRequestException(
        'Cannot estimate the driving route. Check the addresses and retry.',
      );
    }

    const pricing = this.calculatePricing(
      {
        distanceKm,
        packageSize: input.packageSize,
        vehicleType: input.vehicleType,
        discountAmount: input.discountAmount,
      },
      await this.activePolicy(),
    );

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

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  generateDropoffPin(): string {
    const seed = Date.now() % 9000;
    return (1000 + seed).toString();
  }
}
