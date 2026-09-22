/** Strip non-digits (and Persian/Arabic digits → ASCII). */
function toAsciiDigits(value: string): string {
  return String(value || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - '۰'.charCodeAt(0)))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - '٠'.charCodeAt(0)))
    .replace(/\D/g, '');
}

export function normalizeCardNumber(
  value: string | null | undefined,
): string | null {
  if (value == null || String(value).trim() === '') {
    return null;
  }
  const digits = toAsciiDigits(String(value));
  return digits.length > 0 ? digits : null;
}

/** Iranian bank card: exactly 16 digits + Luhn checksum. */
export function isValidIranCardNumber(
  value: string | null | undefined,
): boolean {
  const digits = normalizeCardNumber(value);
  if (!digits || digits.length !== 16) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let n = Number(digits[i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/**
 * Normalize IBAN/Sheba to uppercase IR + 24 digits (no spaces).
 */
export function normalizeIban(value: string | null | undefined): string | null {
  if (value == null || String(value).trim() === '') {
    return null;
  }
  const cleaned = String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');
  const withIr = cleaned.startsWith('IR')
    ? cleaned
    : `IR${toAsciiDigits(cleaned)}`;
  const digits = toAsciiDigits(withIr.slice(2));
  if (!digits) {
    return null;
  }
  return `IR${digits}`;
}

export const normalizeSheba = normalizeIban;

/**
 * Iranian Sheba: IR + 24 digits, ISO 13616 MOD-97 == 1.
 */
export function isValidIranSheba(value: string | null | undefined): boolean {
  const iban = normalizeIban(value);
  if (!iban || !/^IR\d{24}$/.test(iban)) {
    return false;
  }
  // Move country+check to end: digits + 'IR' → digit string with A=10…Z=35
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      expanded += ch;
    } else if (code >= 65 && code <= 90) {
      expanded += String(code - 55);
    } else {
      return false;
    }
  }
  // Mod 97 on big integer via chunking
  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    const block = String(remainder) + expanded.slice(i, i + 7);
    remainder = Number(block) % 97;
  }
  return remainder === 1;
}
