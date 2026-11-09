# Dawam Windows acceptance checklist

Use this checklist on the actual Windows 10/11 work PC. Do not enter real employee data until the clean-install checks pass.

## 1. Installer integrity

- File: `Dawam-Setup-0.1.0-x64.exe`
- SHA-256: `810d8735487078fafda00658603f7f6330e509042596666e1eac065e9914a359`
- Architecture: Windows x64 (64-bit Intel/AMD)
- The current test build is not code-signed. Windows SmartScreen may therefore show an unknown-publisher warning.

In PowerShell, verify the downloaded/copied installer before running it:

```powershell
Get-FileHash .\Dawam-Setup-0.1.0-x64.exe -Algorithm SHA256
```

## 2. Clean installation

1. Run the installer and keep the default per-user install location.
2. Confirm the desktop and Start menu shortcuts open Dawam.
3. Create the first administrator, close Dawam completely, reopen it, and sign in again.
4. Switch Arabic/English and confirm RTL/LTR alignment.
5. Add one disposable employee using a device ID that does not conflict with a real employee.
6. Close and reopen Dawam; confirm the administrator and disposable employee remain saved.

## 3. Real employee setup

- Enter the employee's real name and salary.
- Enter the **device ID exactly as exported by the attendance file**. The supplied real eFace 10 DAT exports IDs `1`, `2`, `3`, `4`, `5`, and `7`; use `1`, not `001`, for an exported ID of `1`.
- Select the normal shift, recurring weekly rest day, and optional coverage teammate.
- Verify all values in Edit Employee after saving.

## 4. USB import acceptance

1. Copy `1_attlog.dat` to a USB drive or local test folder.
2. Open the import wizard and select it.
3. Confirm the preview identifies the verified eFace 10 six-column format and reports 28 valid records with zero malformed rows.
4. Do not confirm an import coverage period that represents a complete working period unless the device export is genuinely complete. The supplied punches were random test punches.
5. Confirm known IDs match their employees and unknown IDs are quarantined for manual mapping.
6. Re-import the same file and confirm it adds zero duplicate punches.

## 5. Shared local data and accounts

1. Create a second administrator in Settings.
2. Log out and sign in as that administrator.
3. Confirm both administrators see the same employees, schedules, attendance, payroll information, backups, and audit history.
4. Edit a disposable employee, close/reopen Dawam, and confirm the update remains saved.

## 6. Backup and restore

1. Create an encrypted backup using a temporary password and a chosen folder.
2. Make a recognizable disposable change.
3. Stage the backup for restore, close Dawam, and reopen it.
4. Confirm the older state and photos return and the automatic pre-restore safety backup exists.

## 7. Upgrade preservation (requires the next test installer)

After the clean-install build passes, install a higher-version Dawam test build over it. Confirm administrators, employees, photos, schedules, punches, attendance corrections, payroll approvals, settings, and audit history remain unchanged.

Record Windows version, architecture, each result, and any screenshot/error in `IMPLEMENTATION.md` before declaring M8 complete.
