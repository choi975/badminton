CREATE TABLE IF NOT EXISTS short_term_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  rule_type TEXT NOT NULL,
  rule_json TEXT NOT NULL DEFAULT '{}',
  expires_on TEXT,
  raw_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_short_term_rules_player
  ON short_term_rules (player_id);

CREATE INDEX IF NOT EXISTS idx_short_term_rules_expires
  ON short_term_rules (expires_on);
