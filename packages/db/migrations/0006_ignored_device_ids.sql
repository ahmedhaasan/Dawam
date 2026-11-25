CREATE TABLE ignored_device_ids (
  device_user_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  ignored_by INTEGER NOT NULL REFERENCES users(id),
  ignored_at TEXT NOT NULL
);

ALTER TABLE quarantined_punches ADD COLUMN ignored_at TEXT;

INSERT INTO schema_version(version,applied_at) VALUES(6,datetime('now'));
