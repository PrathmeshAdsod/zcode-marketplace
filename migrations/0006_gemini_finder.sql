CREATE TABLE gemini_calls (
  id TEXT PRIMARY KEY,
  project_day TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  input_reserved INTEGER NOT NULL,
  output_reserved INTEGER NOT NULL,
  actual_input INTEGER,
  actual_output INTEGER,
  outcome TEXT NOT NULL
);

CREATE INDEX gemini_calls_day ON gemini_calls(project_day);

CREATE INDEX gemini_calls_recent ON gemini_calls(started_at);

CREATE INDEX gemini_calls_lease ON gemini_calls(lease_until);

CREATE TABLE gemini_briefs (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  brief TEXT NOT NULL
);

CREATE INDEX gemini_briefs_expiry ON gemini_briefs(expires_at);
