CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY,
  seed INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submit_expires_at TIMESTAMPTZ NOT NULL,
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  contest_eligible BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS submissions (
  run_id UUID PRIMARY KEY REFERENCES runs (id),
  score INTEGER NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 99),
  victory BOOLEAN NOT NULL,
  duration_ms INTEGER NOT NULL,
  hop_count INTEGER NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('clean', 'flagged', 'rejected')),
  flag_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  prize_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  contest_entry BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  log JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_rank
  ON submissions (score DESC, level DESC, victory DESC, created_at ASC, run_id ASC);
