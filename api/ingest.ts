import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET','POST'].includes(req.method ?? '')) {
    return res.status(405).json({ error:'method_not_allowed' });
  }

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  const bodySecret = typeof req.body?.secret === 'string' ? req.body.secret.trim() : '';
  const oneTimeToken = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
  const isProduction = process.env.VERCEL_ENV === 'production';

  let authorized = !!secret && (
    auth === `Bearer ${secret}` ||
    bodySecret === secret
  );

  if (!authorized && oneTimeToken) {
    try {
      const { sql } = await import('../server/db.js');
      const rows = await sql`
        UPDATE manual_run_tokens
        SET consumed_at=now()
        WHERE token_hash=encode(digest(${oneTimeToken},'sha256'),'hex')
          AND consumed_at IS NULL
          AND expires_at>now()
        RETURNING token_hash
      `;
      authorized = rows.length > 0;
    } catch (e) {
      console.error('manual token auth failed', e);
    }
  }

  if ((secret && !authorized) || (!secret && isProduction)) {
    return res.status(401).json({
      error:'unauthorized',
      cronSecretConfigured: !!secret
    });
  }

  try {
    const mod = await import('../server/agent/runIngestion.js');
    const skipOver = String(req.query?.skipOver ?? req.body?.skipOver ?? '').toLowerCase() === 'true';
    const report = await mod.runEdgeIngestion({ skipOver });
    return res.status(200).json({ ok:true, report });
  } catch (error:any) {
    console.error('Edge ingestion failed', error);
    return res.status(500).json({
      ok:false,
      stage:'ingestion_bootstrap_or_run',
      error:error?.message ?? String(error),
      name:error?.name ?? null,
      databaseUrlConfigured: !!process.env.DATABASE_URL,
      cronSecretConfigured: !!process.env.CRON_SECRET,
      vercelEnv: process.env.VERCEL_ENV ?? null
    });
  }
}
