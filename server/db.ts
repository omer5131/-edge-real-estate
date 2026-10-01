import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not configured');

export const sql = neon(url);

export async function withRun<T>(
  sourceId: string,
  jobType: string,
  scope: Record<string, unknown>,
  fn: (runId: string) => Promise<T & { fetched?: number; inserted?: number; updated?: number; errors?: number }>
) {
  const rows = await sql`
    INSERT INTO ingestion_runs (source_id, job_type, scope, status)
    VALUES (${sourceId}, ${jobType}, ${JSON.stringify(scope)}::jsonb, 'running')
    RETURNING id
  `;
  const runId = String(rows[0].id);
  try {
    const result = await fn(runId);
    await sql`
      UPDATE ingestion_runs SET status='success', finished_at=now(),
        fetched_count=${result.fetched ?? 0},
        inserted_count=${result.inserted ?? 0},
        updated_count=${result.updated ?? 0},
        error_count=${result.errors ?? 0}
      WHERE id=${runId}::uuid
    `;
    return result;
  } catch (error) {
    await sql`
      UPDATE ingestion_runs SET status='failed', finished_at=now(),
        error_count=error_count+1, error_summary=${String(error)}
      WHERE id=${runId}::uuid
    `;
    throw error;
  }
}
