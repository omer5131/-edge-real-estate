import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = '.edge-source';
const parts = fs.readdirSync(dir)
  .filter((name) => /^part-\d+\.txt$/.test(name))
  .sort();

if (!parts.length) {
  throw new Error('Edge source archive parts are missing');
}

const encoded = parts.map((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim()).join('');
const json = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
const files = JSON.parse(json);

for (const [file, content] of Object.entries(files)) {
  const parent = path.dirname(file);
  if (parent !== '.') fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

const nodeTsconfigPath = 'tsconfig.node.json';
if (fs.existsSync(nodeTsconfigPath)) {
  const nodeTsconfig = JSON.parse(fs.readFileSync(nodeTsconfigPath, 'utf8'));
  nodeTsconfig.compilerOptions = {
    ...(nodeTsconfig.compilerOptions || {}),
    noEmit: true
  };
  fs.writeFileSync(nodeTsconfigPath, JSON.stringify(nodeTsconfig, null, 2) + '\n', 'utf8');
}

// Wire the existing polished demo UI to the live Edge backend without
// duplicating the large generated frontend source in Git.
const liveBootstrap = `
import { neighborhoods, properties, dataSources } from './mockData';

type LiveArea = {
  id: string; name: string; city: string; avg_price_sqm?: number; change_1y?: number;
  change_3y?: number; transactions_12m?: number; renewal_projects?: number;
  existing_units?: number; planned_units?: number;
};
type LiveOpportunity = {
  id: string; address: string; neighborhood_id: string; neighborhood: string; city: string;
  asking_price: number; sqm?: number; rooms?: number; floor?: string; price_sqm?: number;
  adjusted_value?: number; discount_pct?: number; renewal_stage?: string; days_on_market?: number;
  seller_motivation?: string; score?: number; price_points?: number; original_price?: number;
};
type LivePayload = { mode: string; areas?: LiveArea[]; opportunities?: LiveOpportunity[]; sources?: any[] };

const areaIdMap: Record<string,string> = {
  'kiryat-eliezer-haifa': 'kiryat-eliezer',
  'kiryat-sprinzak-haifa': 'kiryat-sprinzak',
  'kiryat-nordau-netanya': 'kiryat-nordau',
  'yoseftal-petah-tikva': 'yoseftal'
};

export async function bootstrapEdge() {
  try {
    const response = await fetch('/api/edge-data', { headers: { accept: 'application/json' } });
    if (!response.ok) return { live: false };
    const payload = await response.json() as LivePayload;
    if (payload.mode !== 'live') return { live: false };

    if (Array.isArray(payload.areas) && payload.areas.length) {
      const byId = new Map(neighborhoods.map((n:any) => [n.id, n]));
      for (const area of payload.areas) {
        const id = areaIdMap[area.id] || area.id;
        const current:any = byId.get(id);
        if (!current) continue;
        current.name = area.name || current.name;
        current.city = area.city || current.city;
        current.avgPriceSqm = Number(area.avg_price_sqm || 0);
        current.change1Y = Number(area.change_1y || 0);
        current.change3Y = Number(area.change_3y || 0);
        current.transactions12M = Number(area.transactions_12m || 0);
        current.renewalProjects = Number(area.renewal_projects || 0);
        current.existingUnits = Number(area.existing_units || 0);
        current.plannedUnits = Number(area.planned_units || 0);
        // Unsupported sources are intentionally zeroed rather than retaining demo facts.
        current.avgRent = 0;
        current.grossYield = 0;
        current.socioCluster = 0;
        current.householdIncome = 0;
        current.academicPct = 0;
        current.demographicGrowth = 0;
        current.insight = 'נתוני אמת מ-Edge. מדדים שטרם נאספו מוצגים כ-0/לא זמין ולא כנתוני דמו.';
      }
    }

    if (Array.isArray(payload.opportunities) && payload.opportunities.length) {
      const mapped:any[] = payload.opportunities.map((p) => ({
        id: p.id,
        address: p.address || 'כתובת לא פתורה',
        neighborhoodId: areaIdMap[p.neighborhood_id] || p.neighborhood_id,
        neighborhood: p.neighborhood,
        city: p.city,
        askingPrice: Number(p.asking_price || 0),
        sqm: Number(p.sqm || 0),
        rooms: Number(p.rooms || 0),
        floor: p.floor || '—',
        built: 0,
        priceSqm: Number(p.price_sqm || 0),
        adjustedValue: Number(p.adjusted_value || p.asking_price || 0),
        discountPct: Number(p.discount_pct || 0),
        renewalStage: 'Live',
        daysOnMarket: Number(p.days_on_market || 0),
        sellerMotivation: p.seller_motivation || 'לא זמין',
        estimatedRent: 0,
        grossYield: 0,
        risk: 'בינוני',
        score: Number(p.score || 50),
        saved: false,
        rationale: {
          priceGap: Number(p.discount_pct || 0),
          renewal: 0,
          momentum: 0,
          yield: 0,
          seller: Number(p.days_on_market || 0) > 75 ? 8 : 3,
          compConfidence: 0,
          riskDeduction: 0,
        }
      }));
      properties.splice(0, properties.length, ...mapped);
    }

    if (Array.isArray(payload.sources)) {
      for (const live of payload.sources) {
        const existing:any = dataSources.find((s:any) => s.name === live.name || s.id === live.id);
        if (existing) existing.status = live.last_success_at ? 'Connected' : 'Demo';
      }
    }
    (window as any).__EDGE_LIVE__ = true;
    return { live: true };
  } catch (error) {
    console.warn('Edge live data unavailable; keeping demo fallback.', error);
    return { live: false };
  }
}
`;
fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/liveBootstrap.ts', liveBootstrap, 'utf8');

const mainPath = 'src/main.tsx';
if (fs.existsSync(mainPath)) {
  let main = fs.readFileSync(mainPath, 'utf8');
  if (!main.includes("liveBootstrap")) {
    main = main.replace(
      /import ['"]\.\/index\.css['"];?/,
      (m) => m + "\nimport { bootstrapEdge } from './data/liveBootstrap';"
    );
    const renderMatch = main.match(/ReactDOM\.createRoot\([\s\S]*$/);
    if (renderMatch) {
      const renderCode = renderMatch[0];
      main = main.slice(0, renderMatch.index) +
        "bootstrapEdge().finally(() => {\n  " +
        renderCode.replace(/\n/g, '\n  ') +
        "\n});\n";
    }
    fs.writeFileSync(mainPath, main, 'utf8');
  }
}

const appPath = 'src/App.tsx';
if (fs.existsSync(appPath)) {
  let app = fs.readFileSync(appPath, 'utf8');
  app = app.replace(/Demo mode — mock data/g, 'Live data · demo fallback only if database is unavailable');
  fs.writeFileSync(appPath, app, 'utf8');
}

console.log(`Reconstructed ${Object.keys(files).length} Edge source files and live-data bootstrap.`);
