import { CustomerEntity, CustomerStatus } from './entities/customer.entity';

export class CustomerMobileAmbiguityError extends Error {
  constructor(message = 'Ambiguous customer mobile identity') {
    super(message);
    this.name = 'CustomerMobileAmbiguityError';
  }
}

export interface CustomerIdentityResolution {
  customer: CustomerEntity | null;
  ambiguous: boolean;
}

/**
 * Deterministic selection among historical duplicate Customers sharing mobile.
 *
 * Policy:
 * - Exactly one active non-deleted row → use it.
 * - Multiple active rows → ambiguous (fail closed for auth).
 * - No active rows, exactly one inactive → use for OTP/recovery only.
 * - Multiple inactive rows → ambiguous (fail closed — do not pick lowest id).
 * - No rows → null (caller may create under lock).
 */
export function resolveCustomerByMobileDuplicates(
  customers: CustomerEntity[],
): CustomerIdentityResolution {
  const eligible = (customers || []).filter((c) => !c.isDeleted);
  if (eligible.length === 0) {
    return { customer: null, ambiguous: false };
  }

  const active = eligible.filter((c) => c.status === CustomerStatus.active);
  if (active.length === 1) {
    return { customer: active[0], ambiguous: false };
  }
  if (active.length > 1) {
    return { customer: null, ambiguous: true };
  }

  const inactive = eligible.filter((c) => c.status !== CustomerStatus.active);
  if (inactive.length === 1) {
    return { customer: inactive[0], ambiguous: false };
  }
  if (inactive.length > 1) {
    return { customer: null, ambiguous: true };
  }

  return { customer: null, ambiguous: false };
}
