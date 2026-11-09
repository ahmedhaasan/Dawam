CREATE UNIQUE INDEX ux_quarantined_punch_identity
  ON quarantined_punches(device_user_id, punched_at_local);
CREATE INDEX ix_import_coverage_range
  ON import_coverage(from_local, to_local, confirmed);
CREATE INDEX ix_import_batch_imported_at
  ON import_batches(imported_at);

INSERT INTO schema_version(version, applied_at)
VALUES(3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
