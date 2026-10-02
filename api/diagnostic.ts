import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const result:any = {
    ok: true,
    runtime: process.version,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    databaseUrlConfigured: !!process.env.DATABASE_URL,
    cronSecretConfigured: !!process.env.CRON_SECRET,
    timestamp: new Date().toISOString()
  };

  try {
    await import('@neondatabase/serverless');
    result.neonPackageImport = true;
  } catch (e:any) {
    result.neonPackageImport = false;
    result.neonPackageError = e?.message ?? String(e);
  }

  try {
    await import('../server/db');
    result.dbModuleImport = true;
  } catch (e:any) {
    result.dbModuleImport = false;
    result.dbModuleError = e?.message ?? String(e);
  }

  return res.status(200).json(result);
}
