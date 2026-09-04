CREATE TABLE IF NOT EXISTS group_learning_model_cache (
  id TEXT PRIMARY KEY,
  model_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (id = 'current')
);
