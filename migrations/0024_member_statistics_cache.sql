CREATE TABLE IF NOT EXISTS member_statistics_cache (
  id TEXT PRIMARY KEY CHECK (id = 'current'),
  statistics_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
