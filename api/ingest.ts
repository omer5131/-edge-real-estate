import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET','POST'].includes(req.method ?? '')) {
    return res.status(405).json({ error:'method_not_allowed' });
  }

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  const bodySecret = typeof req.body?.secret === 'string' ? req.body.secret.trim() : '';
  const isProduction = process.env.VERCEL_ENV === 'production';

  const authorized = !!secret && (
    auth === `Bearer ${secret}` ||
    bodySecret === secret
  );

  if ((secret && !authorized) || (!secret && isProduction)) {
    return res.status(401).json({
      error:'unauthorized',
      cronSecretConfigured: !!secret
    });
  }

  try {
    // Dynamic import keeps dependency/bootstrap failures inside this try/catch,
    // so the collector gets a useful JSON error instead of FUNCTION_INVOCATION_FAILED.
    const mod = await import('../server/agent/runIngestion.js');
    const report = await mod.runEdgeIngestion();
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
