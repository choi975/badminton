-- Durable receipts make browser-outbox retries exactly-once at the database boundary.
CREATE TABLE IF NOT EXISTS shake_mutation_receipts (
  id TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  attempt_token TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('shake_revision', '0');
