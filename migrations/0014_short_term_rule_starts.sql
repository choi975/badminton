ALTER TABLE short_term_rules
  ADD COLUMN starts_on TEXT;

UPDATE short_term_rules
SET starts_on = date(created_at, '+8 hours')
WHERE starts_on IS NULL;

CREATE INDEX IF NOT EXISTS idx_short_term_rules_active_window
  ON short_term_rules (player_id, starts_on, expires_on);
