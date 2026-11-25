# Data model (SQLite)

Conventions: `id INTEGER PRIMARY KEY`; timestamps UTC ISO-8601 in `*_at`; business local times as `TEXT 'YYYY-MM-DD HH:mm:ss'` in `*_local`; money INTEGER piastres; booleans 0/1. Soft-delete via `active`.

```sql
CREATE TABLE schema_version(version INTEGER NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);           -- language, tz, lockout, backup path

CREATE TABLE users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, kdf_params TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('admin','user')), can_import INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
  created_at TEXT NOT NULL);

CREATE TABLE employees(
  id INTEGER PRIMARY KEY, full_name TEXT NOT NULL,
  device_user_id TEXT UNIQUE NOT NULL, photo_path TEXT,
  hire_date TEXT, active INTEGER NOT NULL DEFAULT 1,
  monthly_salary_minor INTEGER, wage_basis_days INTEGER NOT NULL DEFAULT 30,
  user_id INTEGER REFERENCES users(id));            -- optional link, separate concept

CREATE TABLE shift_templates(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  start_min INTEGER NOT NULL, end_min INTEGER NOT NULL,          -- minutes from midnight of start date
  in_from_min INTEGER NOT NULL, in_to_min INTEGER NOT NULL,
  out_from_min INTEGER NOT NULL, out_to_min INTEGER,
  late_grace_min INTEGER NOT NULL DEFAULT 0,
  checkout_open_before_end_min INTEGER NOT NULL DEFAULT 10,
  ot_cap_min INTEGER NOT NULL DEFAULT 480,
  CHECK(end_min>start_min AND in_from_min<=in_to_min),
  CHECK(out_to_min IS NULL OR out_from_min<=out_to_min),
  CHECK(late_grace_min>=0 AND checkout_open_before_end_min>=0 AND ot_cap_min>=0));

CREATE TABLE shift_assignments(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
  template_id INTEGER NOT NULL REFERENCES shift_templates(id),
  valid_from TEXT NOT NULL, valid_to TEXT);                       -- dates; no overlaps per employee (service-enforced)

CREATE TABLE weekly_rest(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),        -- ISO 1=Mon
  valid_from TEXT NOT NULL, valid_to TEXT);

CREATE TABLE schedule_overrides(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('shift','rest','work_default','cancel_coverage')),
  template_id INTEGER REFERENCES shift_templates(id), reason TEXT NOT NULL,
  created_by INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(employee_id,date));

CREATE TABLE teammate_pairs(
  id INTEGER PRIMARY KEY, employee_a INTEGER NOT NULL REFERENCES employees(id),
  employee_b INTEGER NOT NULL REFERENCES employees(id), valid_from TEXT NOT NULL, valid_to TEXT,
  CHECK(employee_a<>employee_b));

CREATE TABLE leaves(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
  date_from TEXT NOT NULL, date_to TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('leave','permission')), note TEXT,
  approved_by INTEGER NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE import_batches(
  id INTEGER PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL, format TEXT NOT NULL,
  device_serial TEXT, imported_at TEXT NOT NULL, imported_by INTEGER NOT NULL,
  rows_total INTEGER, rows_new INTEGER, rows_dup INTEGER, rows_quarantined INTEGER, rows_malformed INTEGER);

CREATE TABLE import_coverage(
  id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  from_local TEXT NOT NULL, to_local TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0);

CREATE TABLE raw_punches(
  id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  device_serial TEXT NOT NULL DEFAULT '', device_user_id TEXT NOT NULL,
  punched_at_local TEXT NOT NULL, device_status TEXT, verify_mode TEXT, raw_line TEXT NOT NULL,
  UNIQUE(device_serial, device_user_id, punched_at_local));
CREATE INDEX ix_punch_user_time ON raw_punches(device_user_id, punched_at_local);

CREATE TABLE quarantined_punches(
  id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL, device_user_id TEXT NOT NULL,
  punched_at_local TEXT NOT NULL, raw_line TEXT NOT NULL, resolved_employee_id INTEGER, resolved_at TEXT);

CREATE TABLE punch_corrections(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, shift_date TEXT NOT NULL,
  field TEXT NOT NULL CHECK(field IN('in','out')), new_time_local TEXT,   -- NULL = explicitly none
  reason TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
  voided_at TEXT, UNIQUE(employee_id,shift_date,field,voided_at));

CREATE TABLE payroll_policies(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL,
  version INTEGER NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE payroll_runs(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, month TEXT NOT NULL,   -- 'YYYY-MM'
  policy_id INTEGER NOT NULL, policy_snapshot_json TEXT NOT NULL,
  inputs_snapshot_json TEXT NOT NULL, result_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('approved','void')),
  approved_by INTEGER NOT NULL, approved_at TEXT NOT NULL, void_reason TEXT);
CREATE UNIQUE INDEX ux_payroll_active ON payroll_runs(employee_id,month) WHERE status='approved';

CREATE TABLE audit_log(
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, actor_user_id INTEGER, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT, before_json TEXT, after_json TEXT, reason TEXT,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
-- Trigger forbids UPDATE/DELETE on audit_log.
```

Notes

- Derived data (daily results, month summaries) is computed, not stored, except inside `payroll_runs` snapshots.
- Backfill/migration of `device_serial`: use `''` when unknown so UNIQUE works.
- Template window overlap, assignment overlap, and pair conflicts are validated in services with tests.
- Migration `0007_attendance_rules_v2.sql` rebuilds `shift_templates` because SQLite cannot relax `out_to_min` in place. It copies every existing row, preserves IDs/references, initializes grace to 0, checkout-open-before-end to 10, and overtime cap to 480. It is forward-only and data-preserving.
