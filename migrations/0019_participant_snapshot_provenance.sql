ALTER TABLE booking_session_players
  ADD COLUMN profile_snapshot_reliable INTEGER NOT NULL DEFAULT 1;

UPDATE booking_session_players
SET profile_snapshot_reliable = 0
WHERE session_id IN (
  SELECT id
  FROM booking_sessions
  WHERE date < '2026-08-17'
);
