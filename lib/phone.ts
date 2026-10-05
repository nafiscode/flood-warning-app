/**
 * Thai phone numbers as people type them (081-234-5678, 0812345678, +66 81 234 5678) to the
 * international form the database and SMS providers use (+66812345678). Returns null when it
 * can't be a phone number. Other countries' numbers pass through if typed with a +.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const digits = trimmed.replace(/[\s\-().]/g, "");
  if (/^\+[1-9][0-9]{7,14}$/.test(digits)) return digits;
  if (/^0[0-9]{8,9}$/.test(digits)) return `+66${digits.slice(1)}`;
  if (/^66[0-9]{8,9}$/.test(digits)) return `+${digits}`;
  return null;
}
