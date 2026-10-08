import {
  GatewayEntity,
  GatewayNames,
  GatewayStatus,
} from './entities/gateway.entity';
import {
  GATEWAY_SECRET_FIELDS,
  adminGatewayViewLeaksSecrets,
  toAdminSafeGatewayView,
} from './gateway-admin-view';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('gateway Admin secret serialization (ADMIN-V2-0)', () => {
  const secretGateway = {
    id: 7,
    name: GatewayNames.payping,
    merchantId: 'MERCHANT-SECRET-VALUE',
    username: 'gateway-user-secret',
    password: 'gateway-pass-secret',
    displayOrder: 1,
    status: GatewayStatus.active,
    isDeleted: false,
  } as GatewayEntity;

  it('Admin safe view never includes secret field names or values', () => {
    const view = toAdminSafeGatewayView(secretGateway);
    expect(adminGatewayViewLeaksSecrets(view)).toBe(false);
    for (const field of GATEWAY_SECRET_FIELDS) {
      expect(view).not.toHaveProperty(field);
      expect(JSON.stringify(view)).not.toContain((secretGateway as any)[field]);
    }
    expect(view.merchantIdConfigured).toBe(true);
    expect(view.usernameConfigured).toBe(true);
    expect(view.passwordConfigured).toBe(true);
    expect(view.credentialsConfigured).toBe(true);
  });

  it('marks unconfigured credentials without inventing values', () => {
    const view = toAdminSafeGatewayView({
      ...secretGateway,
      merchantId: null,
      username: '  ',
      password: '',
    } as GatewayEntity);
    expect(view.merchantIdConfigured).toBe(false);
    expect(view.usernameConfigured).toBe(false);
    expect(view.passwordConfigured).toBe(false);
    expect(view.credentialsConfigured).toBe(false);
    expect(adminGatewayViewLeaksSecrets(view)).toBe(false);
  });

  it('Admin controller serializes list/detail through toAdminSafeGatewayView', () => {
    const controller = readFileSync(
      join(__dirname, 'gateway.controller.ts'),
      'utf8',
    );
    expect(controller).toMatch(/toAdminSafeGatewayView\(data\)/);
    expect(controller).toMatch(/toAdminSafeGatewayView\(gateway\)/);
    // Update still accepts credentials and returns a message only (no entity echo).
    expect(controller).toMatch(
      /async update\([\s\S]*?successfulResult\(\['دروازه پرداخت با موفقیت آپدیت شد'\]\)/,
    );
  });

  it('internal getById still returns the full entity for payment processing', () => {
    const service = readFileSync(join(__dirname, 'gateway.service.ts'), 'utf8');
    // Service must not strip secrets; payment verify needs merchantId.
    expect(service).toMatch(/async getById[\s\S]*?return gateway;/);
    expect(service).not.toMatch(/toAdminSafeGatewayView/);
  });
});
