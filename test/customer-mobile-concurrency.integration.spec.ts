import { createConnection, Connection } from 'typeorm';
import { CustomerMobileIdentityService } from '../src/modules/customer/customer-mobile-identity.service';
import {
  CustomerEntity,
  CustomerStatus,
} from '../src/modules/customer/entities/customer.entity';

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';

describe('Customer mobile concurrency (LOCAL DB, isolated fixtures)', () => {
  let connection: Connection;
  let dbAvailable = false;
  let skipReason = '';
  let mobileIdentityService: CustomerMobileIdentityService;
  const createdCustomerIds: number[] = [];

  beforeAll(async () => {
    try {
      connection = await createConnection({
        type: 'mysql',
        host: LOCAL_HOST,
        port: 3306,
        username: 'root',
        password: '',
        database: LOCAL_DB,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      dbAvailable = true;
      mobileIdentityService = new CustomerMobileIdentityService(connection);
    } catch (err) {
      skipReason = err?.message || 'connection failed';
    }
  }, 120000);

  afterAll(async () => {
    if (connection?.isConnected) {
      if (createdCustomerIds.length) {
        await connection.query(
          `DELETE FROM customer WHERE id IN (${createdCustomerIds.join(',')})`,
        );
      }
      await connection.close();
    }
  });

  function requireDb() {
    if (!dbAvailable) {
      throw new Error(`LOCAL DB unavailable: ${skipReason}`);
    }
  }

  it('concurrent first-login for same normalized mobile converges to one customer', async () => {
    requireDb();
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const rawMobile = `0912${suffix.slice(-7)}`;
    const normalized = mobileIdentityService.normalizeMobile(rawMobile);

    const createIfAbsent = async () =>
      mobileIdentityService.withNormalizedMobileLock(normalized, async () => {
        const repo = connection.getRepository(CustomerEntity);
        let customer = await repo.findOne({
          where: { mobile: normalized, isDeleted: false },
        });
        if (!customer) {
          customer = repo.create({
            mobile: normalized,
            status: CustomerStatus.inactive,
            createdAt: new Date(),
            walletUSD: 0,
            walletIRT: 0,
            walletTRY: 0,
            buyPercentToReferrerCreditUSD: null,
            buyPercentToReferrerCreditIRT: null,
            buyPercentToReferrerCreditTRY: null,
          });
          customer = await repo.save(customer);
          createdCustomerIds.push(customer.id);
        }
        return customer.id;
      });

    const [firstId, secondId] = await Promise.all([
      createIfAbsent(),
      createIfAbsent(),
    ]);

    expect(firstId).toBe(secondId);

    const count = await connection
      .getRepository(CustomerEntity)
      .count({ where: { mobile: normalized, isDeleted: false } });
    expect(count).toBe(1);
  });

  it('signup vs admin-create for same normalized mobile converges to one customer', async () => {
    requireDb();
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const rawMobile = `0913${suffix.slice(-7)}`;
    const normalized = mobileIdentityService.normalizeMobile(rawMobile);

    const signupPath = () =>
      mobileIdentityService.withNormalizedMobileLock(normalized, async () => {
        const repo = connection.getRepository(CustomerEntity);
        const existing = await repo.find({
          where: { mobile: normalized, isDeleted: false },
        });
        if (existing.length) {
          return existing[0].id;
        }
        const created = await repo.save(
          repo.create({
            mobile: normalized,
            status: CustomerStatus.inactive,
            createdAt: new Date(),
            walletUSD: 0,
            walletIRT: 0,
            walletTRY: 0,
            buyPercentToReferrerCreditUSD: null,
            buyPercentToReferrerCreditIRT: null,
            buyPercentToReferrerCreditTRY: null,
          }),
        );
        createdCustomerIds.push(created.id);
        return created.id;
      });

    const adminPath = () =>
      mobileIdentityService.withNormalizedMobileLock(normalized, async () => {
        const repo = connection.getRepository(CustomerEntity);
        const existing = await repo.find({
          where: { mobile: normalized, isDeleted: false },
        });
        if (existing.length) {
          return existing[0].id;
        }
        const created = await repo.save(
          repo.create({
            mobile: normalized,
            status: CustomerStatus.active,
            createdAt: new Date(),
            walletUSD: 0,
            walletIRT: 0,
            walletTRY: 0,
            buyPercentToReferrerCreditUSD: null,
            buyPercentToReferrerCreditIRT: null,
            buyPercentToReferrerCreditTRY: null,
          }),
        );
        createdCustomerIds.push(created.id);
        return created.id;
      });

    const [signupId, adminId] = await Promise.all([signupPath(), adminPath()]);
    expect(signupId).toBe(adminId);

    const count = await connection
      .getRepository(CustomerEntity)
      .count({ where: { mobile: normalized, isDeleted: false } });
    expect(count).toBe(1);
  });
});
