CREATE TABLE IF NOT EXISTS court_arrangement_documents (
  document_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  mutation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
