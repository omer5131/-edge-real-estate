import crypto from 'node:crypto';

export function sha256(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function pick(record: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function n(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = typeof value === 'string' ? value.replace(/[₪,\s]/g, '') : value;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function int(value: unknown): number | null {
  const valueN = n(value);
  return valueN === null ? null : Math.trunc(valueN);
}

export function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

export function isoDate(value: unknown): string | null {
  const t = text(value);
  if (!t) return null;
  const dm = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dm) return `${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10);
}
