INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('edc_balance', '860');

CREATE TRIGGER IF NOT EXISTS trg_booking_sessions_edc_balance_insert
AFTER INSERT ON booking_sessions
WHEN NEW.venue = 'EDC'
BEGIN
  UPDATE app_settings
  SET value = CAST(ROUND(CAST(value AS REAL) - NEW.court_count * 80, 2) AS TEXT)
  WHERE key = 'edc_balance';
END;
