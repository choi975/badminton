CREATE TABLE IF NOT EXISTS session_save_receipts (
  request_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
  session_id INTEGER,
  edc_charge REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_session_save_receipts_session
  ON session_save_receipts (session_id);
