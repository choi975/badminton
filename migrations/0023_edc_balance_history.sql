CREATE TABLE edc_balance_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('opening', 'charge', 'adjustment')),
  amount REAL NOT NULL,
  balance_before REAL NOT NULL,
  balance_after REAL NOT NULL,
  session_id INTEGER,
  session_date TEXT,
  court_count REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO edc_balance_history (type, amount, balance_before, balance_after)
SELECT 'opening', 0, CAST(value AS REAL), CAST(value AS REAL)
FROM app_settings WHERE key = 'edc_balance';

DROP TRIGGER IF EXISTS trg_booking_sessions_edc_balance_insert;
CREATE TRIGGER trg_booking_sessions_edc_balance_insert
AFTER INSERT ON booking_sessions
WHEN NEW.venue = 'EDC'
BEGIN
  INSERT INTO edc_balance_history
    (type, amount, balance_before, balance_after, session_id, session_date, court_count)
  SELECT 'charge', -ROUND(NEW.court_count * 80, 2), CAST(value AS REAL),
    ROUND(CAST(value AS REAL) - NEW.court_count * 80, 2), NEW.id, NEW.date, NEW.court_count
  FROM app_settings WHERE key = 'edc_balance';

  UPDATE app_settings
  SET value = CAST(ROUND(CAST(value AS REAL) - NEW.court_count * 80, 2) AS TEXT)
  WHERE key = 'edc_balance';
END;
