ALTER TABLE booking_sessions
  ADD COLUMN actual_shuttle_confirmed INTEGER NOT NULL DEFAULT 0;

UPDATE booking_sessions
SET actual_shuttle_confirmed = 1;
