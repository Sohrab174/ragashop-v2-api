import { HttpException } from '@nestjs/common';
import { AddressService } from './address.service';

function errorDouble() {
  return {
    unprocessableEntity: (messages: string[], data?: unknown) => {
      throw new HttpException({ messages, data }, 422);
    },
    forbidden: (messages: string[]) => {
      throw new HttpException({ messages }, 403);
    },
  };
}

describe('AddressService ownership', () => {
  function harness() {
    const sets: unknown[] = [];
    const wheres: unknown[] = [];
    const inserts: unknown[] = [];
    let findResult: any = null;
    const qb = {
      insert: () => qb,
      update: () => qb,
      values: (value: unknown) => {
        inserts.push(value);
        return qb;
      },
      set: (value: unknown) => {
        sets.push(value);
        return qb;
      },
      where: (a?: unknown) => {
        wheres.push(a);
        return qb;
      },
      andWhere: () => qb,
      leftJoinAndSelect: () => qb,
      orderBy: () => qb,
      addOrderBy: () => qb,
      execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 15 }] }),
      getMany: jest.fn().mockResolvedValue([]),
    };

    const addressRepository = {
      count: jest.fn().mockResolvedValue(1),
      createQueryBuilder: () => qb,
      findOne: jest.fn(async () => findResult),
    };
    const cityRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 10, provinceId: 1 }),
    };
    const service = new AddressService(
      addressRepository as any,
      cityRepository as any,
      errorDouble() as any,
    );
    return {
      service,
      addressRepository,
      cityRepository,
      sets,
      wheres,
      inserts,
      qb,
      setFound: (row: any) => {
        findResult = row;
      },
    };
  }

  const aligned = {
    title: 'خانه',
    recipientFirstName: 'علی',
    recipientLastName: 'رضایی',
    phone: '09121234567',
    address: 'خیابان آزادی، پلاک ۱۲',
    details: 'واحد ۲',
    postalCode: '1234567890',
    cityId: 10,
    isDefault: false,
    customerId: 999,
  };

  it('creates an address only for the authenticated customer', async () => {
    const { service, inserts, setFound } = harness();
    setFound({
      id: 15,
      customerId: 4,
      ...aligned,
      isDefault: false,
      city: { name: 'تهران', provinceId: 1, province: { name: 'تهران' } },
    });
    const view = await service.add(aligned as any, 4);
    expect(inserts[0]).toMatchObject({ customerId: 4, recipientFirstName: 'علی' });
    expect(inserts[0]).not.toMatchObject({ customerId: 999 });
    expect(view.id).toBe(15);
    expect(view).not.toHaveProperty('customerId');
  });

  it('rejects an update when the address is not owned', async () => {
    const { service, sets, addressRepository } = harness();
    addressRepository.findOne.mockResolvedValue(null);
    await expect(
      service.update({ ...aligned, id: 8 } as any, 4),
    ).rejects.toBeInstanceOf(HttpException);
    expect(sets).toEqual([]);
    expect(addressRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, customerId: 4, isDeleted: false }),
    );
  });

  it('rejects an invalid address id', async () => {
    const { service, addressRepository } = harness();
    await expect(
      service.update({ ...aligned, id: 'nope' } as any, 4),
    ).rejects.toBeInstanceOf(HttpException);
    expect(addressRepository.findOne).not.toHaveBeenCalled();
  });

  it('updates only address columns and clears other defaults for the same customer', async () => {
    const { service, sets, wheres, setFound } = harness();
    const save = jest.fn();
    setFound({
      id: 8,
      customerId: 4,
      isDefault: false,
      title: 'خانه',
      address: 'خیابان آزادی، پلاک ۱۲',
      save,
    });
    await service.update({ ...aligned, id: 8, isDefault: true } as any, 4);
    const written = sets[0] as Record<string, unknown>;
    expect(written.recipientFirstName).toBe('علی');
    expect(written).not.toHaveProperty('customerId');
    expect(written).not.toHaveProperty('id');
    expect(sets[1]).toEqual({ isDefault: false });
    expect(wheres.some((w) => JSON.stringify(w).includes('4'))).toBe(true);
  });

  it('refuses to delete another customer address', async () => {
    const { service, addressRepository } = harness();
    addressRepository.findOne.mockResolvedValue(null);
    await expect(
      service.delete(3, { id: 4 } as any),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('allows deleting the only default address and does not touch orders', async () => {
    const save = jest.fn();
    const { service, addressRepository } = harness();
    addressRepository.count.mockResolvedValue(0);
    addressRepository.findOne.mockResolvedValue({
      id: 3,
      customerId: 4,
      isDefault: true,
      isDeleted: false,
      save,
    });
    await service.delete(3, { id: 4 } as any);
    expect(save).toHaveBeenCalled();
  });

  it('refuses to delete the default when another address exists', async () => {
    const save = jest.fn();
    const { service, addressRepository } = harness();
    addressRepository.count.mockResolvedValue(1);
    addressRepository.findOne.mockResolvedValue({
      id: 3,
      customerId: 4,
      isDefault: true,
      isDeleted: false,
      save,
    });
    await expect(
      service.delete(3, { id: 4 } as any),
    ).rejects.toBeInstanceOf(HttpException);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an unknown city', async () => {
    const { service, cityRepository, inserts } = harness();
    cityRepository.findOne.mockResolvedValue(null);
    await expect(service.add(aligned as any, 4)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(inserts).toEqual([]);
  });

  it('persists postal code + coordinates together with the legacy location string', async () => {
    const { service, inserts, setFound } = harness();
    setFound({ id: 15, customerId: 4, ...aligned, city: null });
    await service.add(
      { ...aligned, latitude: 35.6892, longitude: 51.389 } as any,
      4,
    );
    expect(inserts[0]).toMatchObject({
      customerId: 4,
      postalCode: '1234567890',
      latitude: 35.6892,
      longitude: 51.389,
      location: '35.6892000,51.3890000',
    });
  });

  it('updates postal code and coordinates without touching other customers', async () => {
    const { service, sets, setFound, addressRepository } = harness();
    setFound({
      id: 8,
      customerId: 4,
      isDefault: true,
      title: 'خانه',
      address: 'خیابان آزادی، پلاک ۱۲',
    });
    await service.update(
      {
        ...aligned,
        id: 8,
        isDefault: true,
        postalCode: '9876543210',
        latitude: 35.75,
        longitude: 51.45,
      } as any,
      4,
    );
    expect(addressRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, customerId: 4 }),
    );
    expect(sets[0]).toMatchObject({
      postalCode: '9876543210',
      latitude: 35.75,
      longitude: 51.45,
    });
  });

  it('leaves stored coordinates untouched when an update omits them', async () => {
    const { service, sets, setFound } = harness();
    setFound({
      id: 8,
      customerId: 4,
      isDefault: true,
      title: 'خانه',
      address: 'خیابان آزادی، پلاک ۱۲',
    });
    await service.update({ ...aligned, id: 8, isDefault: true } as any, 4);
    const written = sets[0] as Record<string, unknown>;
    expect(written).not.toHaveProperty('latitude');
    expect(written).not.toHaveProperty('longitude');
    expect(written).not.toHaveProperty('location');
  });

  it('rejects out-of-range coordinates before any write', async () => {
    const { service, inserts } = harness();
    await expect(
      service.add({ ...aligned, latitude: 120, longitude: 51 } as any, 4),
    ).rejects.toBeInstanceOf(HttpException);
    expect(inserts).toEqual([]);
  });
});
