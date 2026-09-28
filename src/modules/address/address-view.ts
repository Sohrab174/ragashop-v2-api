import {
  GeoPoint,
  isNullIsland,
  isValidLatitude,
  isValidLongitude,
  parseLocationString,
} from './address-geo';

/**
 * Customer-facing address shape aligned with checkout delivery fields.
 * Does not include customerId — callers already scoped the row.
 */
export type CustomerAddressView = {
  id: number;
  title: string;
  recipientFirstName: string | null;
  recipientLastName: string | null;
  phone: string | null;
  address: string;
  details: string | null;
  postalCode: string | null;
  cityId: number | null;
  provinceId: number | null;
  cityName: string | null;
  provinceName: string | null;
  /** Legacy "lat,lng" — prefer latitude/longitude. */
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
};

type CityRelation = {
  id?: number;
  name?: string | null;
  provinceId?: number | null;
  province?: { id?: number; name?: string | null } | null;
} | null;

function asCoordinate(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toAddressView(row: {
  id: number;
  title: string;
  recipientFirstName?: string | null;
  recipientLastName?: string | null;
  phone?: string | null;
  address: string;
  details?: string | null;
  postalCode?: string | null;
  cityId?: number | null;
  location?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  isDefault?: boolean | number | null;
  city?: CityRelation;
}): CustomerAddressView {
  const city = row.city || null;
  const provinceId =
    city?.provinceId != null
      ? Number(city.provinceId)
      : city?.province?.id != null
      ? Number(city.province.id)
      : null;

  let point: GeoPoint | null = null;
  const lat = asCoordinate(row.latitude);
  const lng = asCoordinate(row.longitude);
  if (lat != null && lng != null && isValidLatitude(lat) && isValidLongitude(lng)) {
    point = { latitude: lat, longitude: lng };
  } else if (lat == null && lng == null && row.location) {
    const parsed = parseLocationString(row.location);
    if (parsed && parsed !== 'invalid') point = parsed;
  }
  if (point && isNullIsland(point)) point = null;
  const latitude = point ? point.latitude : null;
  const longitude = point ? point.longitude : null;

  return {
    id: row.id,
    title: row.title,
    recipientFirstName: row.recipientFirstName ?? null,
    recipientLastName: row.recipientLastName ?? null,
    phone: row.phone ?? null,
    address: row.address,
    details: row.details ?? null,
    postalCode: row.postalCode ?? null,
    cityId: row.cityId ?? null,
    provinceId: provinceId && provinceId > 0 ? provinceId : null,
    cityName: city?.name ?? null,
    provinceName: city?.province?.name ?? null,
    location: row.location ?? null,
    latitude,
    longitude,
    isDefault: row.isDefault === true || row.isDefault === 1,
  };
}
