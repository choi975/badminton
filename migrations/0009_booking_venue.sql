ALTER TABLE booking_sessions ADD COLUMN venue TEXT NOT NULL DEFAULT 'EDC';

UPDATE booking_sessions SET venue = '文体';
