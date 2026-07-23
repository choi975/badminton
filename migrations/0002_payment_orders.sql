CREATE TABLE IF NOT EXISTS payment_orders (
  affiliation TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (affiliation, player_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_affiliation_sort
  ON payment_orders (affiliation, sort_order);
