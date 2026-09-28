/**
 * Ops chat messages may identify a customer by name and order number, but
 * phone numbers are reduced to their last four digits.
 */
export function maskMobileForOps(mobile: string | null | undefined): string {
  if (typeof mobile !== 'string') {
    return '—';
  }
  const digits = mobile.replace(/\D/g, '');
  if (digits.length <= 4) {
    return '****';
  }
  return `***${digits.slice(-4)}`;
}
