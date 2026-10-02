import { createHash } from 'node:crypto';

export const OVER_ORIGIN = 'https://www.over.org.il';
export type Watermark = { seen: string; hash: string };
export type ArchiveSchema = { table: string; columns: string[]; tables?: { table: string }[]; first_seen_column?: string; total?: number };
export type ArchiveRow = Record<string, unknown> & { first_seen: string; row_hash: string };

export function identifier(value: string): string {
  if (!value || value.includes('\0')) throw new Error('Invalid SQL identifier');
  return '"' + value.replaceAll('"', '""') + '"';
}
export function literal(value: string): string {
  if (value.includes('\0')) throw new Error('Invalid SQL literal');
  // Both databases use standard_conforming_strings; reject backslashes to avoid ambiguous literals.
  if (value.includes('\\')) throw new Error('Backslashes are not supported in archive filters');
  return "'" + value.replaceAll("'", "''") + "'";
}
export function datasetTable(id: string): string {
  if (!/^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id)) throw new Error('Invalid dataset UUID');
  return 'over_' + id.replaceAll('-', '').toLowerCase();
}
export function filterClause(filters: Record<string, unknown>, columns: string[]): string {
  return Object.entries(filters).map(([key, value]) => {
    if (!columns.includes(key)) throw new Error(`Unknown filter column: ${key}`);
    const values = Array.isArray(value) ? value : [value];
    if (!values.length || values.some(v => typeof v !== 'string')) throw new Error('Filter values must be nonempty strings or arrays of strings');
    return `${identifier(key)} IN (${values.map(v => literal(String(v))).join(',')})`;
  }).join(' AND ');
}
// Source dates can be DD/MM/YYYY, ISO YYYY-MM-DD, or an annual YYYY field.
export function recordYearClause(column: string | null | undefined, year: number, columns: string[]): string {
  if (!column) return '';
  if (!columns.includes(column) || !Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('Invalid record-date cutoff');
  const field = identifier(column);
  return `(CASE WHEN ${field} ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN right(${field},4) WHEN ${field} ~ '^[0-9]{4}(-[0-9]{2}-[0-9]{2}.*)?$' THEN left(${field},4) ELSE NULL END) >= ${literal(String(year))}`;
}
export function archiveQuery(table: string, options: {
  columns?: string[]; filters?: string; after?: Watermark; lower?: Watermark; upper?: Watermark; since?: string; limit?: number; newest?: boolean;
}): string {
  const clauses: string[] = [];
  if (options.filters) clauses.push(options.filters);
  if (options.after) clauses.push(`("first_seen", "row_hash") > (${literal(options.after.seen)}::timestamptz, ${literal(options.after.hash)})`);
  if (options.upper) clauses.push(`("first_seen", "row_hash") <= (${literal(options.upper.seen)}::timestamptz, ${literal(options.upper.hash)})`);
  if (options.lower && options.since) clauses.push(`(("first_seen", "row_hash") > (${literal(options.lower.seen)}::timestamptz, ${literal(options.lower.hash)}) OR "first_seen" >= ${literal(options.since)}::timestamptz)`);
  else if (options.since) clauses.push(`"first_seen" >= ${literal(options.since)}::timestamptz`);
  const order = options.newest ? 'DESC' : 'ASC';
  const limit = options.newest ? 1 : Math.max(1, Math.min(2000, options.limit ?? 1000));
  return `SELECT ${options.columns?.length?options.columns.map(identifier).join(','):'*'} FROM ${identifier(table)}${clauses.length ? ' WHERE ' + clauses.map(c => `(${c})`).join(' AND ') : ''} ORDER BY "first_seen" ${order}, "row_hash" ${order} LIMIT ${limit}`;
}
export function watermark(row: ArchiveRow): Watermark {
  if (typeof row.first_seen !== 'string' || !Number.isFinite(Date.parse(row.first_seen)) || typeof row.row_hash !== 'string' || !row.row_hash) {
    throw new Error('Archive lacks a valid first_seen / row_hash cursor; ingestion stopped without advancing checkpoint');
  }
  return { seen: row.first_seen, hash: row.row_hash };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  return value;
}
export function payloadHash(row: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex');
}
export async function overJson(path: string, deadline = Date.now() + 90000): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) throw new Error('OVER request budget exhausted; checkpoint retained');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(25000, remaining));
    try {
      const response = await fetch(new URL(path, OVER_ORIGIN), { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'EdgeRealEstate/2.0' } });
      if (!response.ok) {
        const error = new Error(`OVER HTTP ${response.status} for ${path.split('?')[0]}`);
        if (![408,429,500,502,503,504].includes(response.status)) throw Object.assign(error, { permanent: true });
        throw error;
      }
      return await response.json();
    } catch (error: any) {
      if (error.permanent) throw error;
      last = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    } finally { clearTimeout(timeout); }
  }
  throw last;
}
export async function archiveRows(id: string, query: string, deadline?: number): Promise<ArchiveRow[]> {
  const payload = await overJson(`/api/append/${id}/datastore_search_sql?${new URLSearchParams({ sql: query })}`, deadline);
  if (payload.success !== true || !Array.isArray(payload.result?.records)) throw new Error('Invalid OVER SQL response');
  const rows = payload.result.records;
  rows.forEach(watermark);
  return rows;
}
