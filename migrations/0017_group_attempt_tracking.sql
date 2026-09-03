CREATE TABLE IF NOT EXISTS group_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_date TEXT NOT NULL,
  group_key TEXT NOT NULL DEFAULT 'main',
  outcome TEXT NOT NULL DEFAULT 'pending',
  training_state TEXT NOT NULL DEFAULT 'eligible',
  source TEXT NOT NULL DEFAULT 'tracked',
  first_observed_at TEXT,
  last_observed_at TEXT,
  settled_at TEXT,
  outcome_source TEXT,
  qualifying_session_id INTEGER,
  actual_participant_count INTEGER NOT NULL DEFAULT 0,
  max_observed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_date, group_key),
  CHECK (outcome IN ('pending', 'success', 'failure')),
  CHECK (training_state IN ('eligible', 'excluded')),
  CHECK (source IN ('tracked', 'booking_backfill')),
  CHECK (actual_participant_count >= 0),
  CHECK (max_observed_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_group_attempts_outcome_date
  ON group_attempts (outcome, activity_date);

CREATE TABLE IF NOT EXISTS group_attempt_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  client_event_id TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trigger_type TEXT NOT NULL,
  training_state TEXT NOT NULL DEFAULT 'eligible',
  roster_hash TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  participant_count INTEGER NOT NULL,
  known_player_ids_json TEXT NOT NULL DEFAULT '[]',
  companions_by_owner_json TEXT NOT NULL DEFAULT '[]',
  unresolved_count INTEGER NOT NULL DEFAULT 0,
  active_constraints_json TEXT NOT NULL DEFAULT '[]',
  probability_today REAL NOT NULL,
  probability_tomorrow REAL NOT NULL,
  model_version TEXT NOT NULL,
  features_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attempt_id) REFERENCES group_attempts(id) ON DELETE CASCADE,
  CHECK (participant_count >= 0 AND participant_count <= 100),
  CHECK (unresolved_count >= 0 AND unresolved_count <= participant_count),
  CHECK (training_state IN ('eligible', 'excluded')),
  CHECK (probability_today >= 0 AND probability_today <= 1),
  CHECK (probability_tomorrow >= 0 AND probability_tomorrow <= 1)
);

CREATE INDEX IF NOT EXISTS idx_group_attempt_snapshots_attempt_time
  ON group_attempt_snapshots (attempt_id, observed_at, id);

CREATE INDEX IF NOT EXISTS idx_group_attempt_snapshots_state
  ON group_attempt_snapshots (attempt_id, roster_hash, context_hash, observed_at);

-- Booking-only dates are useful attendance outcomes, but have no point-in-time
-- roster observation and therefore stay out of probability calibration.
WITH session_counts AS (
  SELECT
    s.id,
    s.date,
    s.created_at,
    s.updated_at,
    COALESCE(SUM(CASE WHEN p.slots > 0 THEN p.slots ELSE 0 END), 0) AS participant_count
  FROM booking_sessions s
  LEFT JOIN booking_session_players p ON p.session_id = s.id
  GROUP BY s.id, s.date, s.created_at, s.updated_at
), date_counts AS (
  SELECT
    date,
    MIN(created_at) AS first_observed_at,
    MAX(updated_at) AS last_observed_at,
    MAX(participant_count) AS actual_participant_count
  FROM session_counts
  GROUP BY date
)
INSERT OR IGNORE INTO group_attempts (
  activity_date,
  group_key,
  outcome,
  training_state,
  source,
  first_observed_at,
  last_observed_at,
  settled_at,
  outcome_source,
  qualifying_session_id,
  actual_participant_count,
  max_observed_count,
  updated_at
)
SELECT
  counts.date,
  'main',
  CASE
    WHEN counts.actual_participant_count >= 6 THEN 'success'
    WHEN counts.date <= CASE
      WHEN time('now', '+8 hours') >= '12:05:00' THEN date('now', '+8 hours', '-1 day')
      ELSE date('now', '+8 hours', '-2 day')
    END THEN 'failure'
    ELSE 'pending'
  END,
  'excluded',
  'booking_backfill',
  counts.first_observed_at,
  counts.last_observed_at,
  CASE
    WHEN counts.actual_participant_count >= 6 OR counts.date <= CASE
      WHEN time('now', '+8 hours') >= '12:05:00' THEN date('now', '+8 hours', '-1 day')
      ELSE date('now', '+8 hours', '-2 day')
    END THEN counts.last_observed_at
    ELSE NULL
  END,
  CASE
    WHEN counts.actual_participant_count >= 6 THEN 'booking'
    WHEN counts.date <= CASE
      WHEN time('now', '+8 hours') >= '12:05:00' THEN date('now', '+8 hours', '-1 day')
      ELSE date('now', '+8 hours', '-2 day')
    END THEN 'booking_below_threshold'
    ELSE NULL
  END,
  (
    SELECT session_counts.id
    FROM session_counts
    WHERE session_counts.date = counts.date
      AND session_counts.participant_count >= 6
    ORDER BY session_counts.participant_count DESC, session_counts.id ASC
    LIMIT 1
  ),
  counts.actual_participant_count,
  0,
  CURRENT_TIMESTAMP
FROM date_counts counts;

-- Existing code removes superseded and manually dismissed short-term rules.
-- Preserve an append-only copy so later training can reconstruct what was known.
CREATE TABLE IF NOT EXISTS short_term_rule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_rule_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  rule_type TEXT NOT NULL,
  rule_json TEXT NOT NULL DEFAULT '{}',
  starts_on TEXT,
  expires_on TEXT,
  raw_text TEXT NOT NULL DEFAULT '',
  source_created_at TEXT,
  source_updated_at TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (event_type IN ('migration_snapshot', 'created', 'updated', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_short_term_rule_history_player_time
  ON short_term_rule_history (player_id, recorded_at, id);

INSERT INTO short_term_rule_history (
  source_rule_id, event_type, player_id, rule_type, rule_json, starts_on,
  expires_on, raw_text, source_created_at, source_updated_at
)
SELECT
  id, 'migration_snapshot', player_id, rule_type, rule_json, starts_on,
  expires_on, raw_text, created_at, updated_at
FROM short_term_rules;

CREATE TRIGGER IF NOT EXISTS trg_short_term_rules_history_insert
AFTER INSERT ON short_term_rules
BEGIN
  INSERT INTO short_term_rule_history (
    source_rule_id, event_type, player_id, rule_type, rule_json, starts_on,
    expires_on, raw_text, source_created_at, source_updated_at
  ) VALUES (
    NEW.id, 'created', NEW.player_id, NEW.rule_type, NEW.rule_json, NEW.starts_on,
    NEW.expires_on, NEW.raw_text, NEW.created_at, NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_short_term_rules_history_update
AFTER UPDATE ON short_term_rules
BEGIN
  INSERT INTO short_term_rule_history (
    source_rule_id, event_type, player_id, rule_type, rule_json, starts_on,
    expires_on, raw_text, source_created_at, source_updated_at
  ) VALUES (
    NEW.id, 'updated', NEW.player_id, NEW.rule_type, NEW.rule_json, NEW.starts_on,
    NEW.expires_on, NEW.raw_text, NEW.created_at, NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_short_term_rules_history_delete
BEFORE DELETE ON short_term_rules
BEGIN
  INSERT INTO short_term_rule_history (
    source_rule_id, event_type, player_id, rule_type, rule_json, starts_on,
    expires_on, raw_text, source_created_at, source_updated_at
  ) VALUES (
    OLD.id, 'deleted', OLD.player_id, OLD.rule_type, OLD.rule_json, OLD.starts_on,
    OLD.expires_on, OLD.raw_text, OLD.created_at, OLD.updated_at
  );
END;
