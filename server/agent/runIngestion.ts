import { withRun } from '../db';
import { ingestDealsForSettlement, ingestUrbanRenewal, enrichRecentParcels } from '../sources/over';

const TARGET_CITIES = ['חיפה','נתניה','פתח תקווה'];

export async function runEdgeIngestion() {
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), jobs: [] };
  const jobs = report.jobs as unknown[];

  for (const settlement of TARGET_CITIES) {
    const result = await withRun('over_deals','transactions',{ settlement },(runId) =>
      ingestDealsForSettlement(settlement,runId)
    );
    jobs.push({ source:'over_deals', settlement, ...result });
  }

  const renewal = await withRun('urban_renewal_gov','renewal_projects',{},(runId) =>
    ingestUrbanRenewal(runId)
  );
  jobs.push({ source:'urban_renewal_gov', ...renewal });

  const parcel = await withRun('over_nadlan','parcel_enrichment',{},(runId) =>
    enrichRecentParcels(runId)
  );
  jobs.push({ source:'over_nadlan', ...parcel });

  report.finishedAt = new Date().toISOString();
  return report;
}
