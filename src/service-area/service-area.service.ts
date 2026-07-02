import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { COLLECTIONS } from '../common/constants/firestore.constants';

type RideScope = 'within_city' | 'city_to_city' | 'out_of_service';

interface ServiceCity {
  id: string;
  name: string;
  countryCode: string;
  aliases: string[];
}

interface ServiceAreaConfig {
  enabledCountries: { code: string; name: string }[];
  enabledCities: ServiceCity[];
  defaultCountryCode: string;
}

export interface ServiceAreaInfo {
  scope: RideScope;
  pickupCityId?: string;
  pickupCityName?: string;
  dropoffCityId?: string;
  dropoffCityName?: string;
}

const DEFAULT_CONFIG: ServiceAreaConfig = {
  enabledCountries: [{ code: 'NO', name: 'Norway' }],
  enabledCities: [
    {
      id: 'oslo',
      name: 'Oslo',
      countryCode: 'NO',
      aliases: ['Oslo kommune'],
    },
  ],
  defaultCountryCode: 'NO',
};

@Injectable()
export class ServiceAreaService {
  private config: ServiceAreaConfig = DEFAULT_CONFIG;
  private loaded = false;

  constructor(private readonly firebase: FirebaseService) {}

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const snap = await this.firebase.db
      .collection(COLLECTIONS.platformConfig)
      .doc(COLLECTIONS.serviceAreasDoc)
      .get();
    if (snap.exists && snap.data()) {
      this.config = this.parseConfig(snap.data()!);
    }
    this.loaded = true;
  }

  get enabledCitiesLabel(): string {
    return this.config.enabledCities.map((c) => c.name).join(', ');
  }

  validateOrderStops(input: {
    pickupCity?: string;
    pickupState?: string;
    pickupCountryCode?: string;
    dropoffCity?: string;
    dropoffState?: string;
    dropoffCountryCode?: string;
  }): string | null {
    const info = this.classifyStops(input);
    if (info.scope === 'out_of_service') {
      return `SnapBudd is not available in this area yet. We currently serve: ${this.enabledCitiesLabel}.`;
    }
    return null;
  }

  classifyStops(input: {
    pickupCity?: string;
    pickupState?: string;
    pickupCountryCode?: string;
    dropoffCity?: string;
    dropoffState?: string;
    dropoffCountryCode?: string;
  }): ServiceAreaInfo {
    const pickupMatch = this.matchCity(
      input.pickupCity,
      input.pickupState,
      input.pickupCountryCode,
    );
    const dropoffMatch = this.matchCity(
      input.dropoffCity,
      input.dropoffState,
      input.dropoffCountryCode,
    );

    if (!pickupMatch || !dropoffMatch) {
      return {
        scope: 'out_of_service',
        pickupCityId: pickupMatch?.id,
        pickupCityName: pickupMatch?.name ?? input.pickupCity,
        dropoffCityId: dropoffMatch?.id,
        dropoffCityName: dropoffMatch?.name ?? input.dropoffCity,
      };
    }

    const sameCity = pickupMatch.id === dropoffMatch.id;
    return {
      scope: sameCity ? 'within_city' : 'city_to_city',
      pickupCityId: pickupMatch.id,
      pickupCityName: pickupMatch.name,
      dropoffCityId: dropoffMatch.id,
      dropoffCityName: dropoffMatch.name,
    };
  }

  private parseConfig(data: Record<string, unknown>): ServiceAreaConfig {
    const cities: ServiceCity[] = [];
    const rawCities = data.enabledCities;
    if (Array.isArray(rawCities)) {
      for (const item of rawCities) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const id = (row.id ?? '').toString().trim().toLowerCase();
        const name = (row.name ?? '').toString().trim();
        if (!id || !name) continue;
        cities.push({
          id,
          name,
          countryCode: (row.countryCode ?? 'NO').toString().trim().toUpperCase(),
          aliases: Array.isArray(row.aliases)
            ? row.aliases.map((a) => a.toString().trim()).filter(Boolean)
            : [],
        });
      }
    }

    return {
      ...DEFAULT_CONFIG,
      enabledCities: cities.length ? cities : DEFAULT_CONFIG.enabledCities,
      defaultCountryCode: (data.defaultCountryCode ?? 'NO')
        .toString()
        .trim()
        .toUpperCase(),
    };
  }

  private matchCity(
    cityName?: string,
    stateName?: string,
    countryCode?: string,
  ): ServiceCity | null {
    const cc = (countryCode ?? '').trim().toUpperCase();
    if (cc && !this.isCountryEnabled(cc)) return null;

    for (const label of [cityName, stateName]) {
      const normalized = this.normalizeCityName(label);
      if (!normalized) continue;

      for (const city of this.config.enabledCities) {
        if (cc && city.countryCode && cc !== city.countryCode) continue;
        const names = [city.name, ...city.aliases];
        for (const candidate of names) {
          if (this.namesMatch(normalized, this.normalizeCityName(candidate))) {
            return city;
          }
        }
      }
    }
    return null;
  }

  private isCountryEnabled(countryCode: string): boolean {
    const countries =
      this.config.enabledCountries.length > 0
        ? this.config.enabledCountries
        : [{ code: 'NO', name: 'Norway' }];
    return countries.some((c) => c.code === countryCode);
  }

  private normalizeCityName(raw?: string): string {
    return (raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+kommune$/, '')
      .replace(
        /\s+(capital territory|federal territory|federal capital territory)$/,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private namesMatch(detected: string, candidate: string): boolean {
    if (!detected || !candidate) return false;
    if (detected === candidate) return true;
    if (detected.startsWith(`${candidate} `) || candidate.startsWith(`${detected} `)) {
      return true;
    }
    const shorter = detected.length <= candidate.length ? detected : candidate;
    if (shorter.length >= 4) {
      return detected.startsWith(shorter) || candidate.startsWith(shorter);
    }
    return false;
  }
}
