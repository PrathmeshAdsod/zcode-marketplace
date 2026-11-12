ALTER TABLE oauth_states ADD COLUMN return_to TEXT;
ALTER TABLE support_cases ADD COLUMN release_id TEXT REFERENCES releases(id);
CREATE TABLE release_holds (
  release_id TEXT PRIMARY KEY REFERENCES releases(id),
  case_id TEXT NOT NULL REFERENCES support_cases(id),
  reviewer_id TEXT NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL,
  prior_status TEXT NOT NULL CHECK (prior_status IN ('published','archived')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER
);
