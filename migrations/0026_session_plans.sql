CREATE TABLE IF NOT EXISTS session_plans (
  activity_date TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
