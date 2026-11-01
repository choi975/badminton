CREATE TABLE IF NOT EXISTS roster_review_commits (
  request_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  created_players_json TEXT NOT NULL DEFAULT '[]',
  validation_ok INTEGER NOT NULL DEFAULT 1 CHECK (validation_ok = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
