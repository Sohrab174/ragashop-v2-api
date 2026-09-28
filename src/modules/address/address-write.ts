import { prettyText } from '../../utils';
import {
  isValidCheckoutPhone,
  normalizeCheckoutPhone,
} from '../checkout/checkout-phone';
import {
  GeoPersist,
  resolveGeoInput,
  toGeoPersist,
} from './address-geo';
import { normalizePostalCode, postalCodeFieldError } from './address-postal';

/**
 * Columns this service is allowed to write on `address`.
 * customerId is assigned by the caller from the authenticated session.
 * Order delivery columns are never written here.
 */
export type AddressWrite = {
  title: string;
  address: string;
  details: string | null;
  postalCode: string | null;
  phone: string | null;
  cityId: number | null;
  isDefault: boolean;
  includeRecipient: boolean;
  recipientFirstName: string | null;
  recipientLastName: string | null;
  /** When set, latitude/longitude/location are written together. */
  geo: GeoPersist | null;
};

export type AddressWriteResult =
  | { status: 'ok'; id?: number; value: AddressWrite }
  | { status: 'error'; message: string; fields: Record<string, string> };

export type AddressWriteInput = {
  id?: unknown;
  title?: unknown;
  address?: unknown;
  details?: unknown;
  postalCode?: unknown;
  phone?: unknown;
  cityId?: unknown;
  location?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  isDefault?: unknown;
  recipientFirstName?: unknown;
  recipientLastName?: unknown;
  customerId?: unknown;
};

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function textOrNull(value: unknown, max: number): string | null | 'invalid' {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return 'invalid';
  const text = prettyText(String(value));
  if (!text) return null;
  if (text.length > max) return 'invalid';
  return text;
}

function parseCityId(value: unknown): number | null | 'invalid' {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 'invalid';
  return n;
}

export function usesCheckoutAlignedAddress(input: AddressWriteInput): boolean {
  return input.recipientFirstName != null || input.recipientLastName != null;
}

/**
 * Validates a saved-address write.
 * Checkout-aligned payloads (recipient name present) follow the current
 * checkout delivery contract. Legacy payloads stay compatible with the
 * existing storefront that does not send recipient names.
 */
export function buildAddressWrite(
  input: AddressWriteInput,
  intent: 'create' | 'update',
): AddressWriteResult {
  const fields: Record<string, string> = {};
  let id: number | undefined;

  if (intent === 'update') {
    const parsed = Number(input.id);
    if (!Number.isInteger(parsed) || parsed < 1) {
      fields.id = 'آدرس معتبر نیست';
    } else {
      id = parsed;
    }
  }

  const title = typeof input.title === 'string' ? prettyText(input.title) : '';
  if (!title) fields.title = 'عنوان آدرس الزامی است';
  else if (title.length > 45) fields.title = 'عنوان آدرس طولانی است';

  if (typeof input.isDefault !== 'boolean') {
    fields.isDefault = 'وضعیت پیش‌فرض نامعتبر است';
  }

  const aligned = usesCheckoutAlignedAddress(input);
  let address = '';
  let phone: string | null = null;
  let cityId: number | null = null;
  let recipientFirstName: string | null = null;
  let recipientLastName: string | null = null;

  if (aligned) {
    recipientFirstName =
      typeof input.recipientFirstName === 'string'
        ? prettyText(input.recipientFirstName)
        : '';
    recipientLastName =
      typeof input.recipientLastName === 'string'
        ? prettyText(input.recipientLastName)
        : '';
    if (!recipientFirstName) fields.recipientFirstName = 'نام گیرنده الزامی است';
    else if (recipientFirstName.length > 45) {
      fields.recipientFirstName = 'نام گیرنده طولانی است';
    }
    if (!recipientLastName) {
      fields.recipientLastName = 'نام خانوادگی گیرنده الزامی است';
    } else if (recipientLastName.length > 45) {
      fields.recipientLastName = 'نام خانوادگی گیرنده طولانی است';
    }

    address = typeof input.address === 'string' ? prettyText(input.address) : '';
    if (!address || address.length < 5) {
      fields.address = 'آدرس تحویل را کامل وارد کنید';
    }

    const normalized = normalizeCheckoutPhone(
      typeof input.phone === 'string' ? input.phone : '',
    );
    if (!normalized || !isValidCheckoutPhone(normalized)) {
      fields.phone = 'شماره موبایل معتبر نیست';
    } else {
      phone = normalized;
    }

    const parsedCity = parseCityId(input.cityId);
    if (parsedCity == null || parsedCity === 'invalid') {
      fields.cityId = 'شهر معتبر نیست';
    } else {
      cityId = parsedCity;
    }
  } else {
    address = typeof input.address === 'string' ? prettyText(input.address) : '';
    if (!address) fields.address = 'آدرس اجباری است';

    const legacyPhone = textOrNull(input.phone, 45);
    if (legacyPhone === 'invalid') fields.phone = 'شماره تماس طولانی است';
    else phone = legacyPhone;

    const parsedCity = parseCityId(input.cityId);
    if (parsedCity === 'invalid') fields.cityId = 'شهر معتبر نیست';
    else cityId = parsedCity;
  }

  const details = textOrNull(input.details, 128);
  if (details === 'invalid') fields.details = 'جزئیات آدرس طولانی است';

  const postalError = postalCodeFieldError(input.postalCode);
  if (postalError) fields.postalCode = postalError;
  const postalCode = normalizePostalCode(input.postalCode);
  const postalNormalized =
    postalCode === 'invalid' ? null : postalCode;

  const geoResult = resolveGeoInput({
    latitude: input.latitude,
    longitude: input.longitude,
    location: input.location,
    hasLatitude: hasOwn(input, 'latitude'),
    hasLongitude: hasOwn(input, 'longitude'),
    hasLocation: hasOwn(input, 'location'),
  });
  if (geoResult.status === 'error') {
    Object.assign(fields, geoResult.fields);
  }
  const geo = geoResult.status === 'ok' ? toGeoPersist(geoResult) : null;

  if (Object.keys(fields).length) {
    return {
      status: 'error',
      message: 'اطلاعات آدرس ناقص یا نامعتبر است',
      fields,
    };
  }

  return {
    status: 'ok',
    id,
    value: {
      title,
      address,
      details: details === 'invalid' ? null : details,
      postalCode: postalNormalized,
      phone,
      cityId,
      isDefault: input.isDefault === true,
      includeRecipient: aligned,
      recipientFirstName: aligned ? recipientFirstName : null,
      recipientLastName: aligned ? recipientLastName : null,
      geo,
    },
  };
}
