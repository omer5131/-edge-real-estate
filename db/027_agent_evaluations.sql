-- Persisted evaluation framework for neighborhood analytics and agents.

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('deterministic','agent','full')),
  git_sha text,
  model text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  passed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS evaluation_results (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  case_id text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('critical','high','medium','low')),
  passed boolean,
  skipped boolean NOT NULL DEFAULT false,
  duration_ms integer,
  message text,
  question text,
  generated_sql text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,case_id)
);

CREATE INDEX IF NOT EXISTS evaluation_results_run_idx
  ON evaluation_results(run_id,passed,category);

CREATE OR REPLACE VIEW semantic_evaluation_latest AS
WITH latest AS (
  SELECT DISTINCT ON(suite,mode) *
  FROM evaluation_runs
  ORDER BY suite,mode,started_at DESC
)
SELECT
  r.id run_id,r.suite,r.mode,r.git_sha,r.model,r.started_at,r.finished_at,
  r.passed,r.failed,r.skipped,
  e.case_id,e.category,e.severity,e.passed case_passed,e.skipped case_skipped,
  e.duration_ms,e.message,e.question,e.generated_sql,e.details
FROM latest r
JOIN evaluation_results e ON e.run_id=r.id
ORDER BY e.severity,e.case_id;
