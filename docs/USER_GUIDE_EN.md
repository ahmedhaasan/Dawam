# Dawam user guide

## 1. Sign in and shared data

Dawam works offline on one computer. Every administrator account on that computer sees and manages the same employees, schedules, attendance, payroll previews, and settings. Accounts have separate passwords and profile photos. Use **Settings → Add another account** to add an administrator or operator.

## 2. Add an employee

Open **Employees → Add employee** and enter the name, device ID, hire date, salary, normal shift, weekly day off, and optional coverage teammate. The device ID must match the exported attendance file exactly: `1` and `001` are different IDs. A new form is always blank. Edit an employee to change the future schedule or teammate.

Use **Deactivate** when an employee leaves; this preserves history. Permanent deletion is available only for an inactive mistaken record with no attendance, leave, correction, or payroll history.

## 3. Shifts and overnight work

Open **Shifts** to create reusable shift templates. Enter the start and end clocks. If the end is earlier than the start, Dawam clearly treats it as next day. For example, 1:00 PM to 1:00 AM is a 12-hour overnight shift. Dawam recommends safe arrival/departure punch windows, which can still be adjusted.

## 4. Schedule and coverage

The employee form stores the recurring shift, recurring weekly day off, and optional teammate. The **Schedule** page shows the resolved monthly calendar. When one teammate is off, the other covers and the combined work period is used for attendance. If both are off, Dawam marks **Coverage needed**. Historical months remain unchanged when a future schedule changes.

## 5. Import attendance from USB

From **Home**, choose the attendance file, review the preview, confirm the exact period covered by the export, then import. Re-importing the same punches does not duplicate them. Unknown device IDs go to quarantine for an administrator to match once.

Generic CSV/JSON and synthetic formats are tested, and the physical eFace 10 unit's six-column `1_attlog.dat` format is now verified. Legacy XLS reports remain unverified. Never use an unconfirmed export period to determine absence.

## 6. Monthly attendance

Open **Monthly attendance**, select an employee and month, then review every date. First check-in, last check-out, worked hours, lateness, early departure, missing punches, pending import coverage, rest, and confirmed absence are shown separately. Administrators can correct a check-in/out or apply a one-day adjustment with a required reason. Printing includes employee name, device ID, and month.

## 7. Payroll preview

Open **Payroll**, select the employee, month, and deduction method. Dawam shows salary, daily wage, absence days, total lateness, deductions, and net pay. Each date shows actual late time and the applied treatment; an administrator may keep exact minutes or round that date up to the next hour. Review first, then approve. Approval stores an immutable snapshot; a later policy or salary edit does not rewrite it.

## 8. Backup and restore

Open **Settings → Encrypted backup**:

1. Choose a desktop or external-drive folder using the native folder picker.
2. Enter a backup password of at least 10 characters.
3. Select **Create backup** and keep both the file and password safe.

The encrypted `.dawam-backup` file contains the database, employee photos, administrator photos, a manifest, record counts, and checksums.

To restore, choose the backup file, enter its password, and confirm. Dawam validates checksums and database integrity and creates an automatic pre-restore safety backup. Close and reopen Dawam to apply the prepared restore.

## 9. Security and audit

Settings provides automatic session locking, account activation, password reset, permissions, audit verification, and a searchable list of the latest administrative actions. Reasons are required for important edits. Passwords and backup passwords are never stored in the audit trail.

## Current acceptance limits

- Windows installer, clean Windows 10/11 installation, upgrade preservation, and target-PC USB/layout checks are intentionally pending.
- The eFace 10 raw DAT layout is verified. Legacy XLS and a controlled known overnight attendance scenario remain optional follow-up checks.
