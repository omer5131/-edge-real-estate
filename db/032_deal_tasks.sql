-- Additive workflow extension. Task completion is independent of DD verification.
CREATE TABLE IF NOT EXISTS deal_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
 dd_item_id uuid REFERENCES due_diligence_items(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(length(trim(title))>0),
 assignee text,
 due_date date,
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done','cancelled')),
 source_url text,
 observed_at date,
 result text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'done' OR length(trim(coalesce(result,'')))>0)
);
CREATE INDEX IF NOT EXISTS deal_tasks_deal_idx ON deal_tasks(deal_id,status,due_date);
