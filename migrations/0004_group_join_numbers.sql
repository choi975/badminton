CREATE TABLE IF NOT EXISTS group_join_numbers (
  affiliation TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  join_number INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (affiliation, player_id),
  CHECK (affiliation IN ('球友', '海尼克')),
  CHECK (join_number > 0)
);

CREATE INDEX IF NOT EXISTS idx_group_join_numbers_affiliation_number
  ON group_join_numbers (affiliation, join_number, player_id);

INSERT OR IGNORE INTO group_join_numbers (affiliation, player_id, join_number, updated_at)
SELECT
  current_orders.affiliation,
  current_orders.player_id,
  ROW_NUMBER() OVER (
    PARTITION BY current_orders.affiliation
    ORDER BY current_orders.sort_order, current_orders.player_id
  ),
  current_orders.updated_at
FROM (
  SELECT po.affiliation, po.player_id, po.sort_order, po.updated_at
  FROM payment_orders po
  JOIN players p ON p.id = po.player_id
  WHERE (po.affiliation = '球友' AND p.affiliation IN ('球友', '球友+海尼克'))
     OR (po.affiliation = '海尼克' AND p.affiliation IN ('海尼克', '球友+海尼克'))
) current_orders;

INSERT INTO group_join_numbers (affiliation, player_id, join_number)
SELECT
  '球友',
  p.id,
  COALESCE((SELECT MAX(join_number) FROM group_join_numbers WHERE affiliation = '球友'), 0)
    + ROW_NUMBER() OVER (ORDER BY p.id)
FROM players p
WHERE p.affiliation IN ('球友', '球友+海尼克')
  AND NOT EXISTS (
    SELECT 1 FROM group_join_numbers g
    WHERE g.affiliation = '球友' AND g.player_id = p.id
  );

INSERT INTO group_join_numbers (affiliation, player_id, join_number)
SELECT
  '海尼克',
  p.id,
  COALESCE((SELECT MAX(join_number) FROM group_join_numbers WHERE affiliation = '海尼克'), 0)
    + ROW_NUMBER() OVER (ORDER BY p.id)
FROM players p
WHERE p.affiliation IN ('海尼克', '球友+海尼克')
  AND NOT EXISTS (
    SELECT 1 FROM group_join_numbers g
    WHERE g.affiliation = '海尼克' AND g.player_id = p.id
  );
