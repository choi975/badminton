CREATE TABLE IF NOT EXISTS booking_estimator_training_state (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO booking_estimator_training_state (id, revision)
VALUES ('current', 1);

CREATE TRIGGER IF NOT EXISTS trg_estimator_booking_sessions_insert
AFTER INSERT ON booking_sessions
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;

CREATE TRIGGER IF NOT EXISTS trg_estimator_booking_sessions_update
AFTER UPDATE ON booking_sessions
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;

CREATE TRIGGER IF NOT EXISTS trg_estimator_booking_sessions_delete
AFTER DELETE ON booking_sessions
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;

CREATE TRIGGER IF NOT EXISTS trg_estimator_booking_players_insert
AFTER INSERT ON booking_session_players
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;

CREATE TRIGGER IF NOT EXISTS trg_estimator_booking_players_update
AFTER UPDATE ON booking_session_players
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;

CREATE TRIGGER IF NOT EXISTS trg_estimator_booking_players_delete
AFTER DELETE ON booking_session_players
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;

CREATE TRIGGER IF NOT EXISTS trg_estimator_shuttle_types_insert
AFTER INSERT ON shuttle_types
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;

CREATE TRIGGER IF NOT EXISTS trg_estimator_shuttle_types_update
AFTER UPDATE ON shuttle_types
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;

CREATE TRIGGER IF NOT EXISTS trg_estimator_shuttle_types_delete
AFTER DELETE ON shuttle_types
BEGIN
  UPDATE booking_estimator_training_state
  SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'current';
END;
