# Area Intelligence Foundation

This branch introduces a provider-independent statistical-area intelligence layer for the Edge map and area dashboard.

## Architecture

The UI never scores raw OVER or Yad2 tables directly.

```
provider datasets
  -> semantic views / ingestion
  -> canonical Edge entities
  -> verified geographic mappings
  -> long-form area metrics
  -> versioned score snapshots
  -> area_map_cache
  -> vector tiles + lazy dashboard sections
```

Canonical map grain is CBS statistical area. Boundary year is explicit, beginning with 2022.

## New storage

- `area_dimensions`: stable application geography with PostGIS polygons.
- `transaction_area_map`, `listing_area_map`: evidence-backed entity-to-area resolution. No guessed address matching.
- `renewal_area_map`, `infrastructure_area_map`: spatial relationships.
- `area_metric_definitions`: additive metric registry.
- `area_metric_snapshots`: long-form historical metric store.
- `area_score_models`: immutable/versioned score configuration.
- `area_score_snapshots`: reproducible score history.
- `area_map_cache`: small denormalized read model for map requests.
- `area_refresh_runs`: observability for refresh jobs.

## Score v1

Weights are configuration, not code:

- Deal attractiveness 25
- Market momentum 15
- Renewal 20
- Demographics 15
- Rental 10
- Infrastructure 10
- Supply 5

Deal heat is deliberately separate from the total Area Investment Score.

Small samples are shrunk to their city prior with Bayesian K=5. Missing components are reweighted only when configured minimum coverage (60% in v1) is met. Confidence is stored separately from investment score.

## APIs

### Map tiles

`GET /api/area-tiles?z={z}&x={x}&y={y}&layer=deal_heat`

Allowed layers:

- `deal_heat`
- `area_score`
- `price_sqm`
- `price_growth`
- `renewal`
- `population_growth`
- `yield`

The endpoint emits Mapbox Vector Tiles from PostGIS. This avoids shipping nationwide GeoJSON and scales naturally with map zoom/pan.

### Dashboard

`GET /api/area?areaId={uuid}&section=summary`

Sections are independently loadable/cacheable:

- summary
- market
- deals
- renewal
- demographics
- infrastructure
- evidence

### Score models

`GET /api/area-score-model`

Protected writes use the existing `CRON_SECRET` bearer convention:

- create a new immutable model version
- activate an existing version

Weights must total 100. Editing an old model in place is intentionally unsupported.

### Refresh

`POST /api/area-refresh` with `Authorization: Bearer <CRON_SECRET>`.

The refresh sequence:

1. sync canonical area dimensions
2. map transactions/listings/projects using verified geometry only
3. refresh raw metrics
4. normalize peer-relative metrics
5. calculate versioned scores
6. replace the small map read model
7. record run health

## Activation checklist

The schema migration is intentionally not attached to production build yet.

1. Run `npm run test:areas`.
2. Apply `npm run migrate:areas` in a preview/staging database.
3. Run one authenticated `/api/area-refresh`.
4. Validate area counts, mapping rates, score coverage and tile output.
5. Wire the map UI to vector tiles and the dashboard to section APIs.
6. Only after validation, add `node scripts/migrate-area-intelligence.mjs` to the production build and schedule `/api/area-refresh` after daily ingestion.

## Scaling notes

### Why long-form metrics?

New signals can be added by inserting a metric definition and adapter output. The main schema does not need a new column for every research dataset.

### Why an area_map_cache?

Interactive map requests should not join transactions, renewal projects and demographics. Expensive work happens in refresh jobs; map reads are tiny.

### Why vector tiles?

Nationwide polygon GeoJSON becomes expensive quickly. PostGIS MVT requests only return visible polygons and can be cached at the CDN.

### Why explicit mapping tables?

Every transaction/listing can explain how it reached an area and with what confidence. This prevents silent geographic guessing and lets mapping improve independently of scoring.

### Boundary versions

Never merge statistical area boundary vintages implicitly. `boundary_year` is part of the natural key. Future CBS boundaries should be added as a new version and crosswalked deliberately.
