import { HttpException } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { buildCustomerProfilePatch } from './customer-profile';

describe('buildCustomerProfilePatch', () => {
  it('keeps first and last name and drops identity fields', () => {
    const result = buildCustomerProfilePatch({
      firstName: '  علی ',
      lastName: ' رضایی ',
      mobile: '+989121234567',
      email: 'a@example.com',
      id: 9,
      customerId: 3,
      password: 'secret',
      walletIRT: 500,
    });

    expect(result).toEqual({
      status: 'ok',
      patch: { firstName: 'علی', lastName: 'رضایی' },
    });
    if (result.status === 'ok') {
      expect(result.patch).not.toHaveProperty('mobile');
      expect(result.patch).not.toHaveProperty('customerId');
      expect(result.patch).not.toHaveProperty('id');
    }
  });

  it('rejects a mobile-only payload', () => {
    const result = buildCustomerProfilePatch({ mobile: '+989121234567' });
    expect(result.status).toBe('error');
  });

  it('rejects an empty name', () => {
    const result = buildCustomerProfilePatch({
      firstName: '   ',
      lastName: 'رضایی',
    });
    expect(result.status).toBe('error');
  });

  it('rejects a name longer than the column', () => {
    const result = buildCustomerProfilePatch({
      firstName: 'ن'.repeat(46),
      lastName: 'رضایی',
    });
    expect(result.status).toBe('error');
  });
});

describe('CustomerService.updateMe', () => {
  function makeService(findOneResult: { id: number } | null) {
    const sets: unknown[] = [];
    const wheres: unknown[] = [];
    const qb = {
      update: () => qb,
      set: (value: unknown) => {
        sets.push(value);
        return qb;
      },
      where: (value: unknown) => {
        wheres.push(value);
        return qb;
      },
      execute: async () => ({ affected: 1 }),
    };
    const error = {
      unprocessableEntity: (messages: string[]) => {
        throw new HttpException({ messages }, 422);
      },
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(findOneResult),
      createQueryBuilder: () => qb,
    };
    const service = new CustomerService(
      repository as any,
      null,
      null,
      null,
      error as any,
      null,
      null,
      null,
      null,
      null,
    );
    return { service, sets, wheres, repository };
  }

  it('persists only the profile patch for the authenticated id', async () => {
    const { service, sets, wheres } = makeService({ id: 4 });
    await service.updateMe(4, {
      firstName: 'مهدی',
      lastName: 'کاظمی',
    } as any);

    expect(sets).toEqual([{ firstName: 'مهدی', lastName: 'کاظمی' }]);
    expect(wheres).toEqual([{ id: 4, isDeleted: false }]);
    expect(JSON.stringify(sets[0])).not.toContain('mobile');
  });

  it('does not write when the body tries to change mobile', async () => {
    const { service, sets } = makeService({ id: 4 });
    await expect(
      service.updateMe(4, { mobile: '+989000000000' } as any),
    ).rejects.toBeInstanceOf(HttpException);
    expect(sets).toEqual([]);
  });

  it('does not update another customer id supplied in the body', async () => {
    const { service, wheres } = makeService({ id: 4 });
    await service.updateMe(4, {
      firstName: 'مهدی',
      lastName: 'کاظمی',
      id: 99,
      customerId: 99,
    } as any);
    expect(wheres).toEqual([{ id: 4, isDeleted: false }]);
  });

  it('fails closed when the authenticated customer does not exist', async () => {
    const { service, sets } = makeService(null);
    await expect(
      service.updateMe(4, { firstName: 'مهدی', lastName: 'کاظمی' } as any),
    ).rejects.toBeInstanceOf(HttpException);
    expect(sets).toEqual([]);
  });
});
