import {
  GatewayEntity,
  GatewayNames,
  GatewayStatus,
} from './entities/gateway.entity';

/** Secret / private credential fields that must never appear in Admin API responses. */
export const GATEWAY_SECRET_FIELDS = [
  'password',
  'username',
  'merchantId',
] as const;

export type GatewaySecretField = typeof GATEWAY_SECRET_FIELDS[number];

export type AdminSafeGatewayView = {
  id: number;
  name: GatewayNames;
  displayOrder: number;
  status: GatewayStatus;
  isDeleted: boolean;
  merchantIdConfigured: boolean;
  usernameConfigured: boolean;
  passwordConfigured: boolean;
  credentialsConfigured: boolean;
};

function isConfigured(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * WRITE-ONLY secret serialization for Admin reads.
 * Internal payment code may still load the full GatewayEntity.
 */
export function toAdminSafeGatewayView(
  gateway: GatewayEntity,
): AdminSafeGatewayView {
  const merchantIdConfigured = isConfigured(gateway.merchantId);
  const usernameConfigured = isConfigured(gateway.username);
  const passwordConfigured = isConfigured(gateway.password);

  return {
    id: gateway.id,
    name: gateway.name,
    displayOrder: gateway.displayOrder,
    status: gateway.status,
    isDeleted: gateway.isDeleted,
    merchantIdConfigured,
    usernameConfigured,
    passwordConfigured,
    credentialsConfigured:
      merchantIdConfigured || usernameConfigured || passwordConfigured,
  };
}

/** True when a serialized Admin payload still contains any secret field name/value. */
export function adminGatewayViewLeaksSecrets(payload: unknown): boolean {
  if (payload == null || typeof payload !== 'object') {
    return false;
  }
  const json = JSON.stringify(payload);
  for (const field of GATEWAY_SECRET_FIELDS) {
    if (new RegExp(`"${field}"\\s*:`).test(json)) {
      return true;
    }
  }
  return false;
}
