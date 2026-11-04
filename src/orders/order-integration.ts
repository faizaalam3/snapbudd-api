import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export function requestHash(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return input;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function trackingReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(10)].map((byte) => alphabet[byte & 31]).join('');
}
export function nearestOutlet(
  outlets: Array<Record<string, unknown>>,
  lat: number | undefined,
  lng: number | undefined,
) {
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    typeof lng !== 'number' ||
    !Number.isFinite(lng) ||
    Math.abs(lng) > 180
  )
    throw new BadRequestException(
      'Nearest outlet selection requires confirmed delivery lat and lng',
    );
  const radians = (n: number) => (n * Math.PI) / 180;
  const eligible = outlets.filter(
    (o) =>
      o.active === true &&
      typeof o.latitude === 'number' &&
      Number.isFinite(o.latitude) &&
      Math.abs(o.latitude) <= 90 &&
      typeof o.longitude === 'number' &&
      Number.isFinite(o.longitude) &&
      Math.abs(o.longitude) <= 180 &&
      o.address &&
      o.city &&
      o.countryCode &&
      o.contactPhone,
  );
  const distance = (o: Record<string, unknown>) =>
    Math.sin(radians(Number(o.latitude) - lat) / 2) ** 2 +
    Math.cos(radians(lat)) *
      Math.cos(radians(Number(o.latitude))) *
      Math.sin(radians(Number(o.longitude) - lng) / 2) ** 2;
  eligible.sort(
    (a, b) =>
      distance(a) - distance(b) || String(a.id).localeCompare(String(b.id)),
  );
  if (!eligible.length)
    throw new BadRequestException(
      'No active outlet with complete pickup details is available',
    );
  return String(eligible[0].id);
}
