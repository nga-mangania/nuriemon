-- D1 schema for license-api (minimal viable)

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  sku TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active', -- active|revoked|suspended
  issued_at INTEGER NOT NULL,
  expires_at INTEGER, -- nullable
  note TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  pc_id TEXT NOT NULL,
  platform TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  license_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active|deactivated|revoked
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE INDEX IF NOT EXISTS idx_devices_license ON devices(license_id);
CREATE INDEX IF NOT EXISTS idx_devices_pc ON devices(pc_id);

CREATE TABLE IF NOT EXISTS activations (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  FOREIGN KEY (license_id) REFERENCES licenses(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS revoked_jti (
  jti TEXT PRIMARY KEY,
  exp INTEGER NOT NULL
);

