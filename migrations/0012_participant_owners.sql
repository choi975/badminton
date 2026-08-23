ALTER TABLE booking_session_players
  ADD COLUMN owner_player_id INTEGER;

ALTER TABLE booking_session_players
  ADD COLUMN owner_name_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE booking_session_players
  ADD COLUMN is_companion INTEGER NOT NULL DEFAULT 0;

UPDATE booking_session_players
SET owner_player_id = player_id,
    owner_name_snapshot = player_name,
    is_companion = 0;

UPDATE booking_session_players
SET owner_player_id = (
      SELECT id
      FROM players
      WHERE trim(name) = 'oi'
         OR name LIKE 'oi，%'
         OR name LIKE 'oi,%'
      ORDER BY id ASC
      LIMIT 1
    ),
    owner_name_snapshot = 'oi',
    is_companion = 1
WHERE player_id IS NULL
  AND player_name = 'oi +1';

UPDATE booking_session_players
SET owner_player_id = (
      SELECT id
      FROM players
      WHERE trim(name) = '🌹'
         OR name LIKE '🌹，%'
         OR name LIKE '🌹,%'
      ORDER BY id ASC
      LIMIT 1
    ),
    owner_name_snapshot = '🌹',
    is_companion = 1
WHERE player_id IS NULL
  AND player_name = '🌹 +1';

UPDATE booking_session_players
SET owner_player_id = (
      SELECT id
      FROM players
      WHERE trim(name) = '春玲'
         OR name LIKE '春玲，%'
         OR name LIKE '春玲,%'
      ORDER BY id ASC
      LIMIT 1
    ),
    owner_name_snapshot = '春玲',
    is_companion = 1
WHERE player_id IS NULL
  AND player_name = '春玲 +1';

UPDATE booking_session_players
SET owner_player_id = (
      SELECT id
      FROM players
      WHERE trim(name) = '甲乙丙'
         OR name LIKE '甲乙丙，%'
         OR name LIKE '甲乙丙,%'
      ORDER BY id ASC
      LIMIT 1
    ),
    owner_name_snapshot = '甲乙丙',
    is_companion = 1
WHERE player_id IS NULL
  AND player_name IN (
    '🍭 甲乙丙（过阵子打） 代1',
    '🍭 甲乙丙（过阵子打） 代2',
    '🍭 甲乙丙（过阵子打） 代3',
    '🍭 甲乙丙（过阵子打） 代4',
    '🍭 甲乙丙（过阵子打） 代5',
    '🍭 甲乙丙（过阵子打） 代6',
    '🍭 甲乙丙（过阵子打） 代7'
  );

CREATE INDEX IF NOT EXISTS idx_booking_session_players_owner
  ON booking_session_players (owner_player_id);
