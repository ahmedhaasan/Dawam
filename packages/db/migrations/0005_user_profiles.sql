ALTER TABLE users ADD COLUMN photo_path TEXT;

INSERT INTO schema_version(version,applied_at) VALUES(5,datetime('now'));
