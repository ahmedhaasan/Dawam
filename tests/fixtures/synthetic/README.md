# Synthetic fixtures

Only invented test data belongs here. Real employee names, photos, database files, logs, backups, and unsanitized device exports must never be committed.

- `attlog_november_2026_test.dat` is a synthetic six-column ZKTeco/eFace-style
  attendance export for device IDs `2` through `6`. It covers repeated scans,
  overnight shifts, missing punches, lateness, early departure, and overtime.
- `expected_results_november_2026.csv` records the expected daily outcomes used
  for regression and acceptance testing.

The original device export remains local and ignored. These fixtures contain no
employee names, photos, credentials, salaries, or production database content.
