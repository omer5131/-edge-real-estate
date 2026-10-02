import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runEdgeIngestion } from '../server/agent/runIngestion';

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET','POST'].includes(req.method ?? '')) return res.status(405).json({ error:'method_not_allowed' });

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  const bodySecret = typeof req.body?.secret === 'string' ? req.body.secret.trim() : '';
  const isProduction = process.env.VERCEL_ENV === 'production';

  const authorized = !!secret && (
    auth === `Bearer ${secret}` ||
    bodySecret === secret
  );

  if ((secret && !authorized) || (!secret && isProduction)) {
    return res.status(401).json({ error:'unauthorized' });
  }

  try {
    const report = await runEdgeIngestion();
    return res.status(200).json({ ok:true, report });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok:false, error:String(error) });
  }
}
