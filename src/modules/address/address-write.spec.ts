import { buildAddressWrite } from './address-write';
import { toAddressView } from './address-view';

describe('buildAddressWrite', () => {
  const aligned = {
    title: 'خانه',
    recipientFirstName: 'علی',
    recipientLastName: 'رضایی',
    phone: '09121234567',
    address: 'خیابان آزادی، پلاک ۱۲',
    details: 'واحد ۲',
    postalCode: '1234567890',
    cityId: 10,
    isDefault: true,
    customerId: 99,
  };

  it('builds a checkout-aligned write without trusting customerId', () => {
    const result = buildAddressWrite(aligned, 'create');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.recipientFirstName).toBe('علی');
    expect(result.value.recipientLastName).toBe('رضایی');
    expect(result.value.phone).toBe('+989121234567');
    expect(result.value.details).toBe('واحد 2');
    expect(result.value.cityId).toBe(10);
    expect(result.value.isDefault).toBe(true);
    expect(result.value).not.toHaveProperty('customerId');
    expect(result.value.includeRecipient).toBe(true);
  });

  it('rejects an incomplete checkout-aligned address', () => {
    const result = buildAddressWrite(
      {
        ...aligned,
        recipientFirstName: '',
        phone: '123',
        address: 'کو',
        cityId: null,
      },
      'create',
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.fields.recipientFirstName).toBeTruthy();
    expect(result.fields.phone).toBeTruthy();
    expect(result.fields.address).toBeTruthy();
    expect(result.fields.cityId).toBeTruthy();
  });

  it('keeps a legacy payload valid without recipient names', () => {
    const result = buildAddressWrite(
      {
        title: 'محل کار',
        address: 'خیابان تست',
        details: 'پلاک ۱',
        postalCode: '1111111111',
        location: '35.7,51.4',
        cityId: 2,
        phone: '02100000000',
        isDefault: false,
      },
      'create',
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.includeRecipient).toBe(false);
    expect(result.value.geo?.include).toBe(true);
    expect(result.value.geo?.location).toBe('35.7000000,51.4000000');
    expect(result.value.geo?.latitude).toBe(35.7);
    expect(result.value.geo?.longitude).toBe(51.4);
    expect(result.value.phone).toBe('02100000000');
  });

  it('accepts explicit latitude/longitude and rejects out-of-range', () => {
    const ok = buildAddressWrite(
      {
        ...aligned,
        latitude: 35.6892,
        longitude: 51.389,
      },
      'create',
    );
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') {
      expect(ok.value.geo?.latitude).toBeCloseTo(35.6892, 5);
      expect(ok.value.geo?.longitude).toBeCloseTo(51.389, 5);
    }

    const badLat = buildAddressWrite(
      { ...aligned, latitude: 91, longitude: 51 },
      'create',
    );
    expect(badLat.status).toBe('error');
    if (badLat.status === 'error') {
      expect(badLat.fields.latitude).toBeTruthy();
    }

    const badLng = buildAddressWrite(
      { ...aligned, latitude: 35, longitude: 200 },
      'create',
    );
    expect(badLng.status).toBe('error');
    if (badLng.status === 'error') {
      expect(badLng.fields.longitude).toBeTruthy();
    }
  });

  it('rejects digit-only postal codes that are not 10 digits', () => {
    const result = buildAddressWrite(
      { ...aligned, postalCode: '12345' },
      'create',
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.fields.postalCode).toBeTruthy();
    }
  });

  it('allows omitting coordinates so legacy addresses stay valid', () => {
    const result = buildAddressWrite(aligned, 'create');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.value.geo).toBeNull();
    }
  });

  it('requires a positive id on update', () => {
    const result = buildAddressWrite({ ...aligned, id: 0 }, 'update');
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.fields.id).toBeTruthy();
  });

  it('rejects malformed and non-finite coordinates', () => {
    for (const bad of [
      { latitude: 'abc', longitude: 51 },
      { latitude: '35.7', longitude: 'NaN' },
      { latitude: Number.POSITIVE_INFINITY, longitude: 51 },
      { latitude: 35.7 },
      { location: '35.7' },
      { location: 'x,y' },
      { latitude: true, longitude: 51 },
    ]) {
      const result = buildAddressWrite({ ...aligned, ...bad }, 'create');
      expect(result.status).toBe('error');
    }
  });

  it('keeps leading zeros and strips inner spaces in postal codes', () => {
    const result = buildAddressWrite(
      { ...aligned, postalCode: ' 01234 56789 ' },
      'create',
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.value.postalCode).toBe('0123456789');
    }
  });

  it('clears the map pin when latitude/longitude are sent as null', () => {
    const cleared = buildAddressWrite(
      { ...aligned, id: 3, latitude: null, longitude: null },
      'update',
    );
    expect(cleared.status).toBe('ok');
    if (cleared.status === 'ok') {
      expect(cleared.value.geo).toEqual({
        include: true,
        latitude: null,
        longitude: null,
        location: null,
      });
    }
  });
});

describe('toAddressView', () => {
  it('maps city and province without exposing customerId', () => {
    const view = toAddressView({
      id: 5,
      title: 'خانه',
      recipientFirstName: 'علی',
      recipientLastName: 'رضایی',
      phone: '+989121234567',
      address: 'خیابان تست',
      details: 'واحد ۱',
      postalCode: '1234567890',
      cityId: 10,
      location: null,
      latitude: 35.7,
      longitude: 51.4,
      isDefault: true,
      city: {
        name: 'تهران',
        provinceId: 8,
        province: { name: 'تهران' },
      },
    } as any);

    expect(view.provinceId).toBe(8);
    expect(view.cityName).toBe('تهران');
    expect(view.provinceName).toBe('تهران');
    expect(view.latitude).toBe(35.7);
    expect(view.longitude).toBe(51.4);
    expect(view).not.toHaveProperty('customerId');
  });
});
