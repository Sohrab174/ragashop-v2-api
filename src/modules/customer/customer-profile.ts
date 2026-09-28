/**
 * Customer self-profile patch.
 * Identity comes from the authenticated session.
 * Mobile is never writable here — a later verified change must be a
 * separate OTP challenge, not a field on PUT /customers/me.
 */
export type CustomerProfilePatch = {
  firstName?: string;
  lastName?: string;
  address?: string | null;
};

export type CustomerProfilePatchResult =
  | { status: 'ok'; patch: CustomerProfilePatch }
  | { status: 'error'; message: string };

const NAME_MAX = 45;
const ADDRESS_MAX = 2000;

function readName(
  input: Record<string, unknown>,
  key: 'firstName' | 'lastName',
  label: string,
): { status: 'ok'; value?: string } | { status: 'error'; message: string } {
  if (!Object.prototype.hasOwnProperty.call(input, key) || input[key] == null) {
    return { status: 'ok' };
  }
  if (typeof input[key] !== 'string') {
    return { status: 'error', message: `${label} نامعتبر است` };
  }
  const value = String(input[key]).trim();
  if (!value) {
    return { status: 'error', message: `${label} الزامی است` };
  }
  if (value.length > NAME_MAX) {
    return { status: 'error', message: `${label} طولانی است` };
  }
  return { status: 'ok', value };
}

export function buildCustomerProfilePatch(
  input: Record<string, unknown>,
): CustomerProfilePatchResult {
  const patch: CustomerProfilePatch = {};

  const firstName = readName(input, 'firstName', 'نام');
  if (firstName.status === 'error') return firstName;
  if (firstName.value) patch.firstName = firstName.value;

  const lastName = readName(input, 'lastName', 'نام خانوادگی');
  if (lastName.status === 'error') return lastName;
  if (lastName.value) patch.lastName = lastName.value;

  if (
    Object.prototype.hasOwnProperty.call(input, 'address') &&
    input.address != null
  ) {
    if (typeof input.address !== 'string') {
      return { status: 'error', message: 'آدرس نامعتبر است' };
    }
    const address = input.address.trim();
    if (address.length > ADDRESS_MAX) {
      return { status: 'error', message: 'آدرس طولانی است' };
    }
    patch.address = address || null;
  }

  if (
    patch.firstName == null &&
    patch.lastName == null &&
    !Object.prototype.hasOwnProperty.call(patch, 'address')
  ) {
    return { status: 'error', message: 'نام و نام خانوادگی الزامی است' };
  }

  return { status: 'ok', patch };
}
