PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('member','reviewer')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id),
  verifier TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE repo_connections (
  seller_id TEXT NOT NULL REFERENCES accounts(id),
  repo_id INTEGER NOT NULL,
  installation_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (seller_id, repo_id)
);
CREATE INDEX repos_installation ON repo_connections(installation_id);
CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES accounts(id),
  draft TEXT NOT NULL CHECK (json_valid(draft)),
  revision INTEGER NOT NULL DEFAULT 1,
  active_release TEXT REFERENCES releases(id),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX listings_seller ON listings(seller_id,updated_at);
CREATE TABLE listing_slots (
  seller_id TEXT NOT NULL REFERENCES accounts(id),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  listing_id TEXT NOT NULL UNIQUE REFERENCES listings(id),
  PRIMARY KEY (seller_id,slot)
);
CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  revision INTEGER NOT NULL,
  repo_id INTEGER NOT NULL,
  installation_id INTEGER NOT NULL,
  commit_sha TEXT NOT NULL CHECK (length(commit_sha)=40),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  status TEXT NOT NULL CHECK (status IN ('queued','review','changes','published','rejected','archived','held')),
  digest TEXT CHECK (digest IS NULL OR length(digest)=64),
  artifact_key TEXT UNIQUE,
  report TEXT CHECK (report IS NULL OR json_valid(report)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (listing_id,revision)
);
CREATE INDEX releases_status ON releases(status,created_at);
CREATE TRIGGER release_identity_immutable BEFORE UPDATE OF listing_id,revision,repo_id,installation_id,commit_sha,snapshot ON releases
BEGIN SELECT RAISE(ABORT,'release identity is immutable'); END;
CREATE TRIGGER archive_immutable BEFORE UPDATE OF digest,artifact_key,report ON releases WHEN OLD.digest IS NOT NULL
BEGIN SELECT RAISE(ABORT,'archive is immutable'); END;
CREATE TABLE reviews (
  release_id TEXT PRIMARY KEY REFERENCES releases(id),
  reviewer_id TEXT NOT NULL REFERENCES accounts(id),
  decision TEXT NOT NULL CHECK (decision IN ('published','changes','rejected')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES accounts(id),
  seller_id TEXT NOT NULL REFERENCES accounts(id),
  release_id TEXT NOT NULL REFERENCES releases(id),
  digest TEXT NOT NULL CHECK (length(digest)=64),
  license_version TEXT NOT NULL,
  license_text TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 100 AND 100000),
  currency TEXT NOT NULL CHECK (currency='USD'),
  merchant TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment='sandbox'),
  state TEXT NOT NULL DEFAULT 'awaiting' CHECK (state IN ('awaiting','pending','complete','refunded','declined','cancelled','expired')),
  provider_order TEXT UNIQUE,
  provider_capture TEXT UNIQUE,
  provider_refund TEXT UNIQUE,
  accepted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  capture_started INTEGER,
  refund_started INTEGER
);
CREATE UNIQUE INDEX active_purchase ON purchases(buyer_id,release_id)
WHERE state NOT IN ('declined','cancelled','expired');
CREATE INDEX purchase_buyer ON purchases(buyer_id,accepted_at);
CREATE TRIGGER purchase_identity_immutable BEFORE UPDATE OF buyer_id,seller_id,release_id,digest,license_version,license_text,amount,currency,merchant,environment,accepted_at ON purchases
BEGIN SELECT RAISE(ABORT,'purchase agreement is immutable'); END;
CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('verify','deliver','reconcile')),
  subject TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','leased','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL DEFAULT (unixepoch()),
  lease_id TEXT,
  lease_until INTEGER,
  UNIQUE (kind,subject)
);
CREATE INDEX outbox_ready ON outbox(kind,state,available_at);
CREATE TRIGGER enqueue_verification AFTER INSERT ON releases
BEGIN INSERT INTO outbox(id,kind,subject) VALUES ('verify:'||NEW.id,'verify',NEW.id); END;
CREATE TRIGGER settle_purchase AFTER UPDATE OF state ON purchases
WHEN NEW.state='complete' AND OLD.state IN ('awaiting','pending') AND NEW.provider_capture IS NOT NULL
BEGIN
  INSERT INTO entitlements(id,purchase_id) VALUES (NEW.id,NEW.id);
  INSERT INTO outbox(id,kind,subject) VALUES ('deliver:'||NEW.id,'deliver',NEW.id);
END;
CREATE TRIGGER revoke_entitlement AFTER UPDATE OF state ON purchases WHEN NEW.state='refunded'
BEGIN UPDATE entitlements SET revoked_at=unixepoch() WHERE purchase_id=NEW.id AND revoked_at IS NULL; END;
CREATE TABLE inbox (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  subject TEXT,
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  processed_at INTEGER,
  PRIMARY KEY (provider,event_id)
);
CREATE TABLE download_tokens (
  token_hash TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX download_expiry ON download_tokens(expires_at);
CREATE TABLE delivery_events (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id),
  event TEXT NOT NULL CHECK (event IN ('issued','stream_started')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE support_cases (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  purchase_id TEXT REFERENCES purchases(id),
  message TEXT NOT NULL,
  resolution TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX support_actor ON support_cases(account_id,created_at);
CREATE TABLE rate_limits (
  id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX rate_expiry ON rate_limits(expires_at);
