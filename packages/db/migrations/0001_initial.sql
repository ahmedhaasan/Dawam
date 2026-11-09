CREATE TABLE schema_version(
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users(
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE COLLATE NOCASE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  kdf_params TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('admin','user')),
  can_import INTEGER NOT NULL DEFAULT 0 CHECK(can_import IN(0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE employees(
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  device_user_id TEXT UNIQUE NOT NULL,
  photo_path TEXT,
  hire_date TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  monthly_salary_minor INTEGER,
  wage_basis_days INTEGER NOT NULL DEFAULT 30,
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE shift_templates(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  in_from_min INTEGER NOT NULL,
  in_to_min INTEGER NOT NULL,
  out_from_min INTEGER NOT NULL,
  out_to_min INTEGER NOT NULL,
  CHECK(end_min > start_min AND in_from_min <= in_to_min AND out_from_min <= out_to_min)
);

CREATE TABLE shift_assignments(
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  template_id INTEGER NOT NULL REFERENCES shift_templates(id),
  valid_from TEXT NOT NULL,
  valid_to TEXT
);

CREATE TABLE weekly_rest(
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  valid_from TEXT NOT NULL,
  valid_to TEXT
);

CREATE TABLE schedule_overrides(
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('shift','rest','work_default','cancel_coverage')),
  template_id INTEGER REFERENCES shift_templates(id),
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(employee_id,date)
);

CREATE TABLE teammate_pairs(
  id INTEGER PRIMARY KEY,
  employee_a INTEGER NOT NULL REFERENCES employees(id),
  employee_b INTEGER NOT NULL REFERENCES employees(id),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  CHECK(employee_a <> employee_b)
);

CREATE TABLE leaves(
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('leave','permission')),
  note TEXT,
  approved_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE import_batches(
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  format TEXT NOT NULL,
  device_serial TEXT,
  imported_at TEXT NOT NULL,
  imported_by INTEGER NOT NULL REFERENCES users(id),
  rows_total INTEGER,
  rows_new INTEGER,
  rows_dup INTEGER,
  rows_quarantined INTEGER,
  rows_malformed INTEGER
);

CREATE TABLE import_coverage(
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  from_local TEXT NOT NULL,
  to_local TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN(0,1))
);

CREATE TABLE raw_punches(
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  device_serial TEXT NOT NULL DEFAULT '',
  device_user_id TEXT NOT NULL,
  punched_at_local TEXT NOT NULL,
  device_status TEXT,
  verify_mode TEXT,
  raw_line TEXT NOT NULL,
  UNIQUE(device_serial,device_user_id,punched_at_local)
);
CREATE INDEX ix_punch_user_time ON raw_punches(device_user_id,punched_at_local);

CREATE TABLE quarantined_punches(
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  device_user_id TEXT NOT NULL,
  punched_at_local TEXT NOT NULL,
  raw_line TEXT NOT NULL,
  resolved_employee_id INTEGER REFERENCES employees(id),
  resolved_at TEXT
);

CREATE TABLE punch_corrections(
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  shift_date TEXT NOT NULL,
  field TEXT NOT NULL CHECK(field IN('in','out')),
  new_time_local TEXT,
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  voided_at TEXT
);
CREATE UNIQUE INDEX ux_active_punch_correction
  ON punch_corrections(employee_id,shift_date,field)
  WHERE voided_at IS NULL;

CREATE TABLE payroll_policies(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1))
);

CREATE TABLE payroll_runs(
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month TEXT NOT NULL,
  policy_id INTEGER NOT NULL REFERENCES payroll_policies(id),
  policy_snapshot_json TEXT NOT NULL,
  inputs_snapshot_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('approved','void')),
  approved_by INTEGER NOT NULL REFERENCES users(id),
  approved_at TEXT NOT NULL,
  void_reason TEXT
);
CREATE UNIQUE INDEX ux_payroll_active
  ON payroll_runs(employee_id,month)
  WHERE status = 'approved';

CREATE TABLE audit_log(
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

INSERT INTO schema_version(version, applied_at)
VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
