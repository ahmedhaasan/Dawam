CREATE INDEX ix_assignment_employee_range
  ON shift_assignments(employee_id, valid_from, valid_to);
CREATE INDEX ix_rest_employee_range
  ON weekly_rest(employee_id, valid_from, valid_to);
CREATE INDEX ix_pair_a_range
  ON teammate_pairs(employee_a, valid_from, valid_to);
CREATE INDEX ix_pair_b_range
  ON teammate_pairs(employee_b, valid_from, valid_to);
CREATE INDEX ix_leave_employee_range
  ON leaves(employee_id, date_from, date_to);
CREATE INDEX ix_override_employee_date
  ON schedule_overrides(employee_id, date);

INSERT INTO schema_version(version, applied_at)
VALUES(2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
