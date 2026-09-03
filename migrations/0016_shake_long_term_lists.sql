CREATE TABLE IF NOT EXISTS shake_long_term_lists (
  list_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  members_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
