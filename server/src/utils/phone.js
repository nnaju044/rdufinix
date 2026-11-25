export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  const hasInternationalPrefix = value.startsWith('+') || value.startsWith('00');
  const digits = value.replace(/\D/g, '');
  const internationalDigits = value.startsWith('00') ? digits.slice(2) : digits;
  if (!hasInternationalPrefix || internationalDigits.length < 8 || internationalDigits.length > 15 || internationalDigits.startsWith('0')) return null;
  return `+${internationalDigits}`;
}

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
