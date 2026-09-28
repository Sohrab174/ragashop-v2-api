import { GeoCoordinateTransformer } from '../../utils/transformers/GeoCoordinateTransformer';
import {
  formatLocationString,
  isValidLatitude,
  isValidLongitude,
  parseLocationString,
  resolveGeoInput,
} from './address-geo';
import { normalizePostalCode, postalCodeFieldError } from './address-postal';
import { toAddressView } from './address-view';

describe('ACCOUNT-1A geo helpers', () => {
  it('validates WGS84 ranges inclusively', () => {
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-180.1)).toBe(false);
    expect(isValidLatitude(Number.NaN)).toBe(false);
  });

  it('keeps latitude first in the legacy location string', () => {
    expect(formatLocationString({ latitude: 35.7, longitude: 51.4 })).toBe(
      '35.7000000,51.4000000',
    );
    expect(parseLocationString('35.7,51.4')).toEqual({
      latitude: 35.7,
      longitude: 51.4,
    });
    expect(parseLocationString('51.4,200')).toBe('invalid');
  });

  it('returns omitted when no geo keys are sent', () => {
    expect(resolveGeoInput({})).toEqual({ status: 'omitted' });
  });

  it('accepts numeric strings but rejects exponent/NaN hacks', () => {
    expect(
      resolveGeoInput({
        latitude: '35.1234567',
        longitude: '51.7654321',
        hasLatitude: true,
        hasLongitude: true,
      }),
    ).toEqual({
      status: 'ok',
      value: { latitude: 35.1234567, longitude: 51.7654321 },
    });
    expect(
      resolveGeoInput({
        latitude: '3e1',
        longitude: '51',
        hasLatitude: true,
        hasLongitude: true,
      }).status,
    ).toBe('error');
  });

  it('rejects an explicit 0,0 pin and a legacy "0,0" string', () => {
    expect(
      resolveGeoInput({
        latitude: 0,
        longitude: 0,
        hasLatitude: true,
        hasLongitude: true,
      }).status,
    ).toBe('error');
    expect(
      resolveGeoInput({ location: '0,0', hasLocation: true }).status,
    ).toBe('error');
  });

  it('address view ignores 0,0 and never mixes decimal and legacy halves', () => {
    const base = { id: 1, title: 't', address: 'a' };
    expect(
      toAddressView({ ...base, latitude: '0.0000000', longitude: '0.0000000' })
        .latitude,
    ).toBeNull();
    const mixed = toAddressView({
      ...base,
      latitude: '35.7000000',
      longitude: null,
      location: '10,20',
    });
    expect(mixed.latitude).toBeNull();
    expect(mixed.longitude).toBeNull();
    const legacy = toAddressView({ ...base, location: '35.7,51.4' });
    expect(legacy.latitude).toBe(35.7);
    expect(legacy.longitude).toBe(51.4);
  });

  it('never fabricates 0,0 for missing values', () => {
    const result = resolveGeoInput({
      latitude: '',
      longitude: '',
      hasLatitude: true,
      hasLongitude: true,
    });
    expect(result).toEqual({ status: 'ok', value: null });
  });
});

describe('GeoCoordinateTransformer', () => {
  const t = new GeoCoordinateTransformer();
  it('preserves 7 decimal places (~1cm) instead of money rounding', () => {
    expect(t.to(35.12345678)).toBe('35.1234568');
    expect(t.from('35.1234568')).toBe(35.1234568);
    expect(t.to(null)).toBeNull();
    expect(t.from(null)).toBeNull();
  });
});

describe('ACCOUNT-1A postal code', () => {
  it('keeps string semantics with leading zeros', () => {
    expect(normalizePostalCode('0012345678')).toBe('0012345678');
    expect(normalizePostalCode(' 12345 67890 ')).toBe('1234567890');
    expect(normalizePostalCode('')).toBeNull();
  });

  it('applies Iran 10-digit rule only to digit-only values', () => {
    expect(postalCodeFieldError('1234567890')).toBeNull();
    expect(postalCodeFieldError('12345')).toBeTruthy();
    expect(postalCodeFieldError('SW1A 1AA')).toBeNull();
  });
});
