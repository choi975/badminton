CREATE TABLE IF NOT EXISTS booking_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  court_count INTEGER NOT NULL DEFAULT 1,
  court_fee REAL NOT NULL DEFAULT 0,
  shuttle_price REAL NOT NULL DEFAULT 0,
  shuttle_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_sessions_date
  ON booking_sessions (date);

CREATE TABLE IF NOT EXISTS booking_session_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  player_id INTEGER,
  player_name TEXT NOT NULL DEFAULT '',
  slots INTEGER NOT NULL DEFAULT 1,
  plus_count INTEGER NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  is_female INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_session_players_session
  ON booking_session_players (session_id);

CREATE INDEX IF NOT EXISTS idx_booking_session_players_player
  ON booking_session_players (player_id);
