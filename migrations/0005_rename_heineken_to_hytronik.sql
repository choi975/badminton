-- Keep player names unchanged; this migration only renames affiliation and payment grouping data.
UPDATE players
SET affiliation = CASE affiliation
  WHEN '海尼克' THEN 'Hytronik'
  WHEN '球友+海尼克' THEN '球友+Hytronik'
  ELSE affiliation
END,
updated_at = CURRENT_TIMESTAMP
WHERE affiliation IN ('海尼克', '球友+海尼克');

UPDATE payment_orders
SET affiliation = 'Hytronik',
    updated_at = CURRENT_TIMESTAMP
WHERE affiliation = '海尼克';

ALTER TABLE group_join_numbers RENAME TO group_join_numbers_legacy;

CREATE TABLE group_join_numbers (
  affiliation TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  join_number INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (affiliation, player_id),
  CHECK (affiliation IN ('球友', 'Hytronik')),
  CHECK (join_number > 0)
);

INSERT INTO group_join_numbers (affiliation, player_id, join_number, updated_at)
SELECT
  CASE affiliation WHEN '海尼克' THEN 'Hytronik' ELSE affiliation END,
  player_id,
  join_number,
  updated_at
FROM group_join_numbers_legacy;

DROP TABLE group_join_numbers_legacy;

CREATE INDEX idx_group_join_numbers_affiliation_number
  ON group_join_numbers (affiliation, join_number, player_id);
