/**
 * ACCOUNT-1A — standard WGS84 coordinates + legacy "lat,lng" location string.
 * Provider-agnostic: no Mapbox/Map.ir IDs in the domain model.
 */

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type GeoParseResult =
  | { status: 'omitted' }
  | { status: 'ok'; value: GeoPoint | null }
  | { status: 'error'; message: string; fields: Record<string, string> };

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidLatitude(value: number): boolean {
  return isFiniteNumber(value) && value >= LAT_MIN && value <= LAT_MAX;
}

export function isValidLongitude(value: number): boolean {
  return isFiniteNumber(value) && value >= LNG_MIN && value <= LNG_MAX;
}

/** 0,0 is the classic "missing value" default; never a real delivery pin here. */
export function isNullIsland(point: GeoPoint): boolean {
  return point.latitude === 0 && point.longitude === 0;
}

/** Compact legacy string used by Admin Map.ir markers: "lat,lng". */
export function formatLocationString(point: GeoPoint | null): string | null {
  if (!point) return null;
  return `${Number(point.latitude).toFixed(7)},${Number(point.longitude).toFixed(
    7,
  )}`;
}

export function parseLocationString(raw: unknown): GeoPoint | null | 'invalid' {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return 'invalid';
  const text = raw.trim();
  if (!text) return null;
  const parts = text.split(',');
  if (parts.length !== 2) return 'invalid';
  const latitude = Number(parts[0].trim());
  const longitude = Number(parts[1].trim());
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return 'invalid';
  }
  return { latitude, longitude };
}

function coerceCoordinate(value: unknown): number | null | 'invalid' {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return 'invalid';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'invalid';
    return value;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (!/^-?\d+(\.\d+)?$/.test(text)) return 'invalid';
    const n = Number(text);
    return Number.isFinite(n) ? n : 'invalid';
  }
  return 'invalid';
}

/**
 * Accept either explicit latitude/longitude or a legacy location string.
 * Both coordinates must be present together, or both absent/cleared.
 * When none of the geo keys are present, result is `omitted` so UPDATE
 * leaves existing coordinates alone.
 */
export function resolveGeoInput(input: {
  latitude?: unknown;
  longitude?: unknown;
  location?: unknown;
  hasLatitude?: boolean;
  hasLongitude?: boolean;
  hasLocation?: boolean;
}): GeoParseResult {
  const hasLat = input.hasLatitude === true;
  const hasLng = input.hasLongitude === true;
  const hasLoc = input.hasLocation === true;

  if (!hasLat && !hasLng && !hasLoc) {
    return { status: 'omitted' };
  }

  if (hasLat || hasLng) {
    const latitude = coerceCoordinate(input.latitude);
    const longitude = coerceCoordinate(input.longitude);
    const fields: Record<string, string> = {};

    if (latitude === 'invalid' || (latitude != null && !isValidLatitude(latitude))) {
      fields.latitude = 'عرض جغرافیایی نامعتبر است';
    }
    if (
      longitude === 'invalid' ||
      (longitude != null && !isValidLongitude(longitude))
    ) {
      fields.longitude = 'طول جغرافیایی نامعتبر است';
    }
    if (
      (latitude == null || latitude === 'invalid') &&
      longitude != null &&
      longitude !== 'invalid'
    ) {
      fields.latitude = fields.latitude || 'عرض جغرافیایی الزامی است';
    }
    if (
      (longitude == null || longitude === 'invalid') &&
      latitude != null &&
      latitude !== 'invalid'
    ) {
      fields.longitude = fields.longitude || 'طول جغرافیایی الزامی است';
    }
    if (Object.keys(fields).length) {
      return {
        status: 'error',
        message: 'موقعیت روی نقشه نامعتبر است',
        fields,
      };
    }
    if (latitude == null && longitude == null) {
      return { status: 'ok', value: null };
    }
    const value = { latitude: latitude as number, longitude: longitude as number };
    if (isNullIsland(value)) {
      return {
        status: 'error',
        message: 'موقعیت روی نقشه نامعتبر است',
        fields: { latitude: 'موقعیت انتخاب‌شده معتبر نیست' },
      };
    }
    return { status: 'ok', value };
  }

  const parsed = parseLocationString(input.location);
  if (parsed === 'invalid' || (parsed && isNullIsland(parsed))) {
    return {
      status: 'error',
      message: 'موقعیت روی نقشه نامعتبر است',
      fields: { location: 'موقعیت مکانی نامعتبر است' },
    };
  }
  return { status: 'ok', value: parsed };
}

export type GeoPersist = {
  include: boolean;
  latitude: number | null;
  longitude: number | null;
  location: string | null;
};

export function toGeoPersist(result: GeoParseResult): GeoPersist | null {
  if (result.status === 'omitted') return null;
  if (result.status === 'error') return null;
  if (result.value == null) {
    return { include: true, latitude: null, longitude: null, location: null };
  }
  return {
    include: true,
    latitude: result.value.latitude,
    longitude: result.value.longitude,
    location: formatLocationString(result.value),
  };
}
