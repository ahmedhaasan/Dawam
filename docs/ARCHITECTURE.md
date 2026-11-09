# Architecture

## Stack

- Electron (main + preload + renderer), React 18 + TypeScript (strict), Vite, Zustand or React Query for state.
- i18n: i18next (`ar`, `en`), CSS logical properties (`margin-inline-start`) for RTL/LTR. Font with Arabic support (e.g. Noto Sans Arabic / Cairo) bundled locally.
- SQLite via `better-sqlite3` (rebuilt for Electron with `electron-builder install-app-deps`). Alternative: Node built-in `node:sqlite` if the Electron version supports it (ADR-3).
- Luxon for time. Zod for validation. Vitest for unit tests, Playwright (Electron) for E2E. electron-builder (NSIS) for installer.
- Password hashing: Node `crypto.scrypt` (no native dep) with per-user salt and stored params.

## Repo layout

```
packages/core/      pure TS: schedule resolver, matcher, statuses, payroll policies, coverage
packages/db/        migrations, repositories, backup/restore, audit chain
packages/importers/ parsers (zk-attlog, csv, json) -> NormalizedPunch[]
apps/desktop/
  src/main/         app lifecycle, IPC handlers, auth/session, services
  src/preload/      typed contextBridge API
  src/renderer/     React UI, i18n, routes
tests/fixtures/     synthetic data and sanitized real-export fixtures
docs/
```

Dependency direction: renderer → preload API → main → db/importers → core. `core` imports nothing from the others.

## Layers

1. **Core**: deterministic functions. `resolveSchedule(emp, date, ctx)`, `matchPunches(instance, punches)`, `computeStatus(...)`, `summarizeMonth(...)`, `calculatePayroll(inputs, policy)`. Clock injected.
2. **Services (main)**: AttendanceService, ImportService, PayrollService, BackupService, AuthService. Each method: authorize → validate → transaction → audit → return DTO.
3. **IPC**: one channel per method, typed in `shared/ipc.ts`. No generic "run SQL" channel. Errors returned as `{ok:false, code, message_key}`.
4. **Renderer**: no business logic beyond view formatting.

## Security

- `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, strict CSP, no remote content, block navigation/new windows.
- Session lives in main; roles checked in every service method (not in UI).
- Payroll/salary DTOs omitted for non-admin at the service layer.
- Audit chain: `hash = sha256(prev_hash || canonical_json(entry))`; verify-chain command in admin tools.
- No telemetry. Logs exclude salaries and names.

## Data & storage

- Paths: DB `%APPDATA%/Dawam/dawam.sqlite`, photos `%APPDATA%/Dawam/photos/`, backups default `Documents/Dawam Backups` (user-changeable, e.g. USB).
- PRAGMAs: `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=FULL` for write safety.
- Imports run in a single transaction; failure rolls back entirely.
- Migrations: numbered SQL, `schema_version` table, automatic pre-migration backup.

## Backup / restore

- Backup = SQLite online backup API snapshot + photos + `manifest.json` (app version, schema version, counts, sha256 of each file) zipped; optional password (AES, ADR-5).
- Restore: validate manifest + checksums → refuse newer schema → auto-create "pre-restore" backup → swap → run migrations → integrity check (`PRAGMA integrity_check`) → restart app.
- Scheduled reminder (weekly) if no backup in N days.

## Packaging

- NSIS installer, per-user install default, upgrade preserves `%APPDATA%`. Code signing optional but recommended (SmartScreen).
- Auto-update disabled in v1 (offline); manual installer upgrade tested.

## ADRs (summary; details in DECISIONS.md)

ADR-1 Electron+React+TS. ADR-2 SQLite local. ADR-3 better-sqlite3 vs node:sqlite. ADR-4 integer minor units. ADR-5 backup encryption optional. ADR-6 core is pure and shared by main and tests.
