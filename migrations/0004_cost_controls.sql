CREATE TABLE cost_usage (
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (metric, period)
) WITHOUT ROWID;

CREATE TABLE cost_alerts (
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (metric, period)
) WITHOUT ROWID;

CREATE TABLE cost_pauses (
  operation TEXT PRIMARY KEY CHECK (operation IN ('ai','verification','checkout')),
  paused INTEGER NOT NULL CHECK (paused IN (0,1)),
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES accounts(id),
  changed_at INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

CREATE TABLE cost_actions (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  paused INTEGER NOT NULL CHECK (paused IN (0,1)),
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE cost_artifacts (
  object_key TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 8388608),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

CREATE TRIGGER reserve_archive_bytes AFTER INSERT ON cost_artifacts
BEGIN
  INSERT INTO cost_usage(metric,period,amount) VALUES ('r2Bytes','all',NEW.bytes)
  ON CONFLICT(metric,period) DO UPDATE SET amount=cost_usage.amount+excluded.amount;
END;

CREATE TRIGGER release_unused_archive_reservation AFTER DELETE ON cost_artifacts
BEGIN
  UPDATE cost_usage SET amount=MAX(0,amount-OLD.bytes) WHERE metric='r2Bytes' AND period='all';
END;

CREATE INDEX outbox_verify_lease ON outbox(kind,state,lease_until);
