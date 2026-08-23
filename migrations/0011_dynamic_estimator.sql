ALTER TABLE booking_sessions
  ADD COLUMN train_court INTEGER NOT NULL DEFAULT 1;

ALTER TABLE booking_sessions
  ADD COLUMN train_shuttle INTEGER NOT NULL DEFAULT 1;

UPDATE booking_sessions SET train_court = 0 WHERE date = '2026-08-10';
UPDATE booking_sessions SET train_shuttle = 0 WHERE date = '2026-08-04';

CREATE TABLE IF NOT EXISTS shuttle_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  prices_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO shuttle_types (id, name, full_name, prices_json)
VALUES
  ('rsl3', '亚3', '亚狮龙3号', '[11,11.3,11.5]'),
  ('as05', 'AS05', '尤尼克斯AS05', '[13.5]');

CREATE TABLE IF NOT EXISTS booking_estimator_models (
  id TEXT PRIMARY KEY,
  model_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
