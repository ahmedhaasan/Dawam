CREATE INDEX IF NOT EXISTS ix_payroll_policies_active
  ON payroll_policies(active, created_at);

CREATE INDEX IF NOT EXISTS ix_payroll_runs_history
  ON payroll_runs(employee_id, month, approved_at);

CREATE TRIGGER payroll_run_snapshot_immutable
BEFORE UPDATE OF employee_id, month, policy_id, policy_snapshot_json,
  inputs_snapshot_json, result_json, approved_by, approved_at ON payroll_runs
BEGIN
  SELECT RAISE(ABORT, 'approved payroll snapshot is immutable');
END;

INSERT INTO schema_version(version, applied_at)
VALUES(4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
