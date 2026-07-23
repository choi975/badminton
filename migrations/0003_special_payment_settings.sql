ALTER TABLE players
  ADD COLUMN participates_payment INTEGER NOT NULL DEFAULT 1;

UPDATE players
SET affiliation = '特殊',
    participates_payment = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE name LIKE '%海尼克-徐攀%'
   OR name LIKE '%Baymax%';

UPDATE players
SET affiliation = '特殊',
    participates_payment = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE name LIKE '%达哥的领导%';

DELETE FROM payment_orders
WHERE player_id IN (
  SELECT id
  FROM players
  WHERE affiliation = '特殊'
);
