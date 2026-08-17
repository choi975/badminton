ALTER TABLE booking_session_players
  ADD COLUMN gender_snapshot TEXT NOT NULL DEFAULT '不详';

ALTER TABLE booking_session_players
  ADD COLUMN level_snapshot TEXT NOT NULL DEFAULT '不详';

UPDATE booking_session_players
SET gender_snapshot = COALESCE(
  (SELECT gender FROM players WHERE players.id = booking_session_players.player_id),
  CASE WHEN is_female = 1 THEN '女' ELSE '不详' END
)
WHERE gender_snapshot = '不详';

UPDATE booking_session_players
SET level_snapshot = COALESCE(
  (SELECT level FROM players WHERE players.id = booking_session_players.player_id),
  '不详'
)
WHERE level_snapshot = '不详';

ALTER TABLE players DROP COLUMN booking_time;
