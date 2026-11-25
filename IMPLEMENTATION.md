# Implementation log

Rule: update in the same change as each step. Entry format below. Never mark a check as passed unless it was run.

## Entry template

### YYYY-MM-DD — Mx: short title

- Done:
- Validation run (commands + result):
- PENDING checks:
- Blockers / new open decisions:
- Next:

## History

## 2026-11-25 — Payroll clarity: charged-day formula, wrapped statuses, and coverage

- Done:
  - documented and tested the reported 69-minute / EGP 1,200 case: with the active `full_day_any` rule, six affected dates are charged at the EGP 200 daily wage, so the result is `6 × EGP 200 = EGP 1,200`; the EGP 100 late-hour price is deliberately inactive for this method;
  - the payroll breakdown now shows both total late minutes and the number of charged dates, plus the explicit charged-days × daily-wage formula whenever a full-day method contributes to the total;
  - long localized attendance statuses wrap and remain contained in the status column instead of overlapping the scheduled-shift column;
  - coverage days show a localized Coverage badge next to their merged shift time, using the existing coverage colour token;
  - lateness and overtime selectors now have distinct warning/positive pills and RTL/LTR-aware directional cues while retaining the established payroll structure and colours;
  - fixed the follow-up table-paint regression by keeping the shift `<td>` as a native table cell and moving its wrapping layout into an inner container. This restores continuous row backgrounds and aligned borders while preserving status wrapping and the Coverage badge.
- Validation run (commands + result): `CI=true pnpm check` PASS (ESLint 0 warnings, all strict workspace typechecks, 20 test files and 131/131 tests). `CI=true pnpm build` PASS for Electron main, sandboxed preload, and renderer. The focused core payroll suite passed 76/76 tests, including the new 69-minute/six-date regression. Follow-up regression validation: direct Electron main/renderer TypeScript PASS, targeted ESLint PASS, targeted Prettier PASS, and `git diff --check` PASS. Live Electron/CDP inspection at a 1500×900 viewport confirmed 11 cells per payroll row; status and shift remain `table-cell`, share the exact row height, and retain matching white/rest/review backgrounds without the reported white blocks or displaced borders.
- PENDING checks: owner visual acceptance with the real payroll data in Arabic and English.
- Blockers / new open decisions: none. The calculation was not changed because it already follows the selected full-day rule; the presentation now makes the active formula unambiguous.
- Next: owner checks the open payroll screen at full size and a resized window, then confirms the wrapped status, Coverage badge, selector cues, and formula wording.

## 2026-11-24 — Follow-up 2: attendance stickiness/last rows, payroll v3 layout

- New `useStickyOffsets` hook publishes the live top-bar and toolbar heights as CSS variables (`--topbar-h`, `--sticky-bar-h`).
- Attendance: the employee/month toolbar is now sticky at every width; it was previously disabled at 1000px and below, which matched the user's window. It is static only when the height is 560px or less. The day table is sized to the visible area under the toolbar, and `overscroll-behavior: contain` was removed so wheel scrolling chains to the page. The last days (29–30 Nov) are now reachable.
- Payroll "Layout v3", following `payroll_mockup_v3`:
  - At 1560px and wider: a sticky 330px summary panel (net, counters, breakdown, current rules, actions) beside a full-height day table.
  - Below 1560px: a net banner, then counters, breakdown and rules in three columns above the table.
  - The day table uses a fixed column plan, so the status column no longer swallows width. It fits without horizontal scroll at 1366, 1440 and 1920.
  - Per-day method selects are stacked with "Late" and "Overtime" tags.
  - Removed the "Layout v2" CSS block.
- Validation: `pnpm lint`, `pnpm typecheck` and `CI=true pnpm test` (130/130) pass, and `pnpm build` passes. Harness screenshots were checked with no horizontal page overflow: payroll ar/en at 1000, 1366, 1440 and 1920; attendance ar/en at 1000, 1366 and 1920, scrolled to the bottom.
- PENDING: manual check on the user's real machine and data.

## 2026-11-24 — Follow-up: attendance/payroll space use, Settings typography, device format notes

- Done:
  - **Fonts:** an old `[dir='ltr'] body` rule switched English to Segoe/Arial while controls used Cairo, which mixed the fonts on Payroll and Settings. Cairo is now used in both directions.
  - **Payroll:** the stacked summary grid never applied below 1600px, because the base `.pb-summary { display:flex }` rule came later and overrode it, leaving narrow cards and empty space.
    - The summary is now a two-column grid (one column below 1100px) with a full-width net-salary banner.
    - The day table is denser: 15px text and a minimum width of 1120px instead of 1320px, so there is less sideways scrolling.
  - **Monthly attendance:** the employee/month toolbar is sticky under the top bar; it becomes static at ≤1000px wide or ≤640px tall. The summary tiles now stretch to fill each row.
  - **Settings:** same type scale as the rest of the app: 22px headings, 15–16px labels, inputs and notes, 44px buttons, readable table actions, equal input heights.
  - **Device format (from `test data/1_attlog (1).dat`, ZKTeco/LX50 USB export):** 6 tab-separated columns:
    - `PIN` (right-aligned with spaces), `YYYY-MM-DD HH:MM:SS`, machine no. (`1`), state (`0` on every row; the device does not record IN/OUT), verify mode (`1` fingerprint, `0` password/other), work code (`0`).
    - One PIN covers all of an employee's enrolled fingers.
    - In/out is therefore derived from shift windows, never from the state column. The parser already handles this.
- Validation run: see the commands below (lint, typecheck, test, build); Playwright screenshots of payroll, attendance and settings at 1280 and 1920, ar and en, with no horizontal overflow.
- PENDING checks: none new.

### 2026-12-05 — Enhancement pass: final integration, responsive QA and change log

- Done:
  - **Global design:** applied the "new payroll and design" fonts, colors and structure app-wide. Body text is larger and headings are heavier. z-index layers (`--z-sticky-head`, `--z-sticky-col`, `--z-dialog`) cover sticky headers, sticky columns and dialogs. Dialogs render in a portal on `document.body`.
  - **Shell:** collapsible sidebar that remembers its state (`dawam.sidebarCollapsed`) and stays sticky. Window `minWidth` lowered to 860.
  - **Settings:** "Reset all app data" with a typed `RESET` confirmation and an optional backup export first.
  - **Overflow/sticky root causes fixed:**
    - `overflow-x: hidden` on html/body made the body a scroll container, so the sidebar scrolled away. Now `overflow-x: clip`.
    - RTL sticky cells inside the schedule's scroll box leaked width to the page. Fixed with `contain: paint` on `.wf-team-wrap`.
    - The payroll layout stacks below 1600px so the day table keeps its width.
  - **Payroll:** the column "Day net" is renamed "Day adjustment (±)": it shows bonus − deductions for the day, not the base salary.
  - **Fixture:** `attlog_november_2026_test.dat` contained 17 real-device lines for IDs 1 and 7. Removed them, leaving 430 lines for IDs 2–6 only. The importer test was updated to match.
- Validation run (commands + result):
  - `pnpm lint`: pass.
  - `pnpm typecheck`: pass.
  - `CI=true pnpm test`: 20 files, 130 tests passed, including the November acceptance test.
  - `pnpm build`: pass.
  - Playwright/Electron screenshots (outside the repo):
    - 7 screens × {900, 1366, 1440, 1920} × {ar, en}: no page-level horizontal overflow, no page errors.
    - Dialogs (payroll rules, attendance edit, add employee, add shift, delete employee) at 1366: no overlap.
- PENDING checks:
  - Manual click-through of save flows on a real device export.
  - The real-device-file test is skipped when the file is absent.
- Blockers / new open decisions: none (payroll choices recorded in ADR-19).
- Next: user acceptance on real data.

#### Change log (this enhancement pass)

- **Attendance:**
  - new statuses EARLY_LEAVE and REVIEW;
  - scans within 5 minutes merge into one punch;
  - after-midnight punches belong to the previous workday;
  - icon actions (check-in / check-out / edit), with a required reason;
  - sticky header, date column and actions column;
  - a status guide and "+1" next-day badges.
- **Import:**
  - re-import replaces punches for the same device ID and date, so there is no stale data;
  - validation report (parsed rows, bad rows, unknown IDs, duplicates, repeat scans, date range, punches per employee, rows replaced);
  - tab-padded IDs are parsed.
  - Employee 3 / 26 Nov "no check-in/out": not reproducible on a clean import (now IN 09:43, OUT 23:25 = EARLY_LEAVE). Root cause was stale punches accumulating under `INSERT OR IGNORE`; fixed by replace-on-reimport, with a regression test.
- **Employees:**
  - new grouped Add/Edit form with inline validation;
  - delete fixed (Electron does not support `window.prompt()`), using an in-app dialog with a purge preview and typed confirmation; re-create plus re-import works with no orphan rows.
- **Shifts:** new form with shift start/end (overnight), check-in and check-out windows, grace, and a live timeline.
- **Schedule:** team table plus a per-employee calendar; rest and cover days styled differently.
- **Payroll:**
  - summary panel (net, breakdown, counters, active rule) plus a sticky day table;
  - one rules dialog ordered as shared prices → late method → overtime method;
  - per-minute late price = hour price ÷ 60, shown read-only;
  - per-day method override uses the shared prices, and a custom amount requires a reason;
  - totals equal the sum of the days.
- **Settings:** Reset all app data.
- **Shell:** collapsible sidebar; responsive down to about 900px.

### 2026-11-24 — Enhancement: employees, shifts and monthly schedule redesign; employee purge fix

- Done:
  - **Delete bug root cause:** the Employees screen collected the typed device ID and the reason with `window.prompt()`. Electron does not support `prompt()` (it returns `null`), so the handler returned silently and never reached IPC. The service, IPC schema and purge SQL were correct.
  - **Delete fix:** new in-app `EmployeeDeleteDialog` built on a new `workforce:employees:purge-preview` IPC (zod-validated, manage role). It lists what will be removed, requires a reason plus the exact typed device ID, and calls `deleteEmployee`. The service now deactivates an active employee in the same transaction, with an `employee.deactivated` audit record before `employee.purged` (DOMAIN_RULES §9 updated). The new repository `countEmployeeData` provides the counts.
  - **Test:** extended `apps/desktop/tests/workforce-service.test.ts`. It sets up device ID `0042` with schedule, pair, rest, override, leave, imported punches, correction, approved payroll run and resolved quarantine, then:
    - deletes the active employee;
    - checks every table column `employee_id`/`employee_a`/`employee_b`/`resolved_employee_id`/`device_user_id` for orphans, plus `PRAGMA foreign_key_check`;
    - checks the audit chain;
    - re-creates `0042` and re-imports cleanly.
  - **Employees screen:** larger type, search and status filter, cleaner table. `EmployeeForm` dialog with grouped fieldsets:
    - Identity, Employment + Pay, and Schedule (shift, weekly rest, coverage teammate);
    - a live coverage explanation (merged hours, warning when both teammates rest on the same day);
    - inline per-field validation, with duplicate device ID shown inline from both a client check and the server error;
    - 2 columns, 1 column under 900 px; the dialog fits the viewport and scrolls internally.
  - **Shifts screen:** cards with a compact `ShiftTimeline` on a shared range. `ShiftForm` dialog:
    - HH:mm inputs with +1/−1 day badges, check-in from/to, check-out from/until or open-ended (`outToMin = null`, OT cap enabled), and late grace;
    - a live 24–36 h timeline (shift, grace, late marker, check-in/out windows, midnight), built with logical properties so it is RTL-correct;
    - help text for first-IN/last-OUT, late, overtime and midnight;
    - client validation mirroring core `validateShiftTemplate`, with server `details` codes mapped to fields.
  - **Monthly schedule:** a "team" month table (employees × days) that scrolls in its own container, with sticky header, sticky name column and a sticky corner via `--z-sticky-*`. There is also a per-employee calendar with counts. SHIFT, COVERAGE, REST (hatched), COVERAGE_NEEDED (red, highlighted), NO_SCHEDULE and leave each have a distinct colour, a label and a legend entry.
  - **Plumbing:** new files `WfDialog.tsx`, `EmployeeForm.tsx`, `EmployeeDeleteDialog.tsx`, `ShiftForm.tsx`, `ShiftTimeline.tsx` and `workforceShared.ts`. All CSS is in `styles/workforce.css`, scoped under `.wf-*` roots. New `wf.*` i18n keys in ar and en.
- Validation run: `pnpm typecheck` PASS; `pnpm lint` PASS (0 warnings); `CI=true pnpm test` PASS (20 files, 130 tests); `pnpm build` PASS.
- PENDING checks: visual RTL/LTR check of the three screens and dialogs at 900, 1366×768, 1440×900 and 1920×1080 in the running app.
- Blockers / new open decisions: none.

### 2026-11-24 — Enhancement: payroll screen redesign (rules dialog, summary panel, day table)

- Done: rewrote `PayrollScreen.tsx` as a summary panel (large net salary; breakdown base → absence → late → overtime → custom adjustments → net, matching the engine total; counters for present/absent/rest/early-leave/review/late min/overtime min; "Active rules" card with method, price explanation, grace and an Edit rules button; month salary override; approve/print) next to a day table that scrolls in its own container with sticky header, sticky date (start) and day-net (end) columns, opaque backgrounds and z-index tokens (logical `inset-inline-*`, works RTL/LTR). Columns: date, status, shift, actual IN/OUT (+1/−1 day badge), late min (+ early-leave minutes), late deduction, overtime min (+ counted), overtime addition, per-day method overrides (custom amount needs a reason), day net. New `PayrollRulesDialog.tsx` puts late and overtime side by side: 1) shared prices, 2) default late method, 3) default overtime method, with live explanations. Helpers in `payroll-rules.ts`; CSS in `styles/payroll.css` scoped under `.payroll-board`. Payroll re-reads attendance on mount, employee/month change, window visibility, and via a Refresh button. Core: `presentDays` now includes `EARLY_LEAVE` (ADR-19). New core test covers EARLY_LEAVE/REVIEW handling, shared-price repricing (including overridden days) and totals = sum of per-day results. i18n `payroll.board.*` keys in ar and en.
- Validation run: `pnpm typecheck` PASS; `pnpm lint` PASS (0 warnings); `pnpm build` PASS; `CI=true pnpm test` 129/130 PASS — the only failure is `packages/importers/tests/importers.test.ts` (synthetic November fixture row count, owned by concurrent import work, unrelated to payroll).
- PENDING checks: visual RTL/LTR check of the payroll screen and rules dialog at 900–1920 px in the running app.
- Blockers / new open decisions: none.

### 2026-11-24 — Enhancement: import validation report

- Done: pure `summarizePunches` in `packages/importers` (valid rows, exact duplicate lines, repeated scans ≤300 s per ID using the engine's debounce rule, covered date range/days, per-ID count/days/first/last); raw ZK parser now strips leading spaces **and tabs** before the ID column (previously a tab-padded ID became an empty column). `ImportRepository.countDayPunchesToReplace` (read-only, shares selection with `deleteDayPunches`). `ImportService.preview` and `commit` return `report` (bad rows first 50 with line + reason, unknown IDs with counts, per-employee table with names/status, stored punches to replace); commit adds `rowsReplaced`. Import wizard shows summary cards, collapsible bad rows, a sticky-header scrolling per-employee table, a post-commit result dialog saying attendance and payroll now use the new data (ar+en); dialogs portal to `document.body`; styles in `styles/import.css`.
- Validation run: `pnpm lint` PASS; `CI=true pnpm test` PASS (20 files, 130 tests); `pnpm build` PASS; `pnpm typecheck` FAILS only in `PayrollRulesDialog.tsx` (concurrent work by another agent, not import code). Local real export `test data /1_attlog (1).dat` (read in place, skipped when absent): 91 rows, 0 malformed, IDs 1→5, 2→11, 3→19, 4→20, 5→19, 6→5, 7→12.
- PENDING: visual RTL/LTR check of the report at 900–1920 px in the running app.
- Blockers: `tests/fixtures/synthetic/attlog_november_2026_test.dat` contains 17 lines identical to the real export (IDs 1 and 7); it is not purely synthetic and must be sanitized before it is committed.

### 2026-12-05 — Enhancement pass 1: November acceptance, import replace, sidebar, app reset

- Done: added `EARLY_LEAVE` (OUT before the checkout window opens) and `REVIEW` (an unmatched punch between IN window end and OUT window start) statuses to core, summary, i18n and styles. Imports now replace stored punches for the same device ID and date that are absent from the newer file (inside the commit transaction, count in the audit record), fixing stale monthly data after re-import. Added a collapsible sidebar (state in localStorage), Settings > "Reset all app data" (typed `RESET`, keeps users/settings/shift templates/audit; backup card above is the optional export), and global CSS safeguards (no horizontal page scroll, bolder body/headings, z-index tokens). Added synthetic fixtures `tests/fixtures/synthetic/attlog_november_2026_test.dat` and `expected_results_november_2026.csv`, plus `apps/desktop/tests/november-acceptance.test.ts` (matches the CSV for IDs 2-6, emp 3 on 26 Nov regression, replace-on-reimport). Acceptance setup uses a 20-minute grace, IN window start..start+120 min and open-ended OUT zones.
- Validation run: `CI=true pnpm test` 20 files / 124 tests PASS; `pnpm typecheck` PASS; `pnpm lint` PASS (0 warnings).
- PENDING checks: emp 3 on 26 Nov already resolved correctly by the engine in the acceptance setup (the UI symptom likely came from stale/old punches or template windows; not reproducible with fresh import). Not yet done: import validation report UI, Add employee/Shift redesigns with timeline, schedule restyle, attendance icon actions and sticky-column rework, payroll layout redesign (side-by-side rules, summary panel), responsive checks at 1366/1440/1920/900 widths, build.
- Blockers / new open decisions: none.
- Next: attendance table sticky/icon rework, then payroll redesign per `new payroll and design`.

### 2026-11-24 — M9c DONE: operational polish, destructive controls, and responsive desktop layout

- Done: aligned the complete renderer with the offline Cairo typography and payroll color/weight system; added responsive desktop breakpoints for compact and full-width windows; replaced unclear attendance action icons with bilingual text; made import, attendance, and payroll table controls sticky where they scroll; clarified that the import preview sample contains raw device IDs rather than only unknown employees; and made payroll load the selected employee-month automatically with its per-day editor inline beneath the selected row. Corrected attendance evaluation so a complete accepted IN/OUT pair is PRESENT immediately while `NOT_CLOSED` is only an incomplete, still-open shift and now reads “waiting for checkout.” Added an exact device-ID-confirmed employee purge that removes the employee and all employee-owned schedules, punches, corrections, payroll runs, leave, quarantine, and ignored-ID state so a later import starts clean. Added an administrator-only audit-history reset that requires `RESET`, a reason, and confirmation, then leaves a new cryptographically valid reset marker.
- Validation run (commands + result): `CI=true pnpm check` PASS with ESLint 0 warnings, every strict TypeScript project PASS, and 19 test files / 118 tests PASS. The new regression proves a 10:00 IN and 21:52 OUT is PRESENT with 8 early-leave minutes even before the configured OUT zone closes. Database/service tests prove exact-confirmation purge, related-record removal, safe re-import state, audit-reset marker creation, deletion protection restoration, and valid audit-chain verification. `CI=true pnpm build` PASS for Electron main, sandboxed CommonJS preload, renderer, and bundled Cairo assets. `git diff --check` PASS.
- PENDING checks: the ordinary browser renderer cannot exercise authenticated screens because the Electron preload bridge is intentionally unavailable outside the desktop shell. Final interactive Arabic/English review at compact Windows window sizes, real USB import, clean install, and upgrade preservation remain target-PC acceptance tasks.
- Blockers / new open decisions: none for local implementation. Employee purge and audit reset are intentionally separate destructive operations; neither is performed automatically.
- Next: owner reviews the updated Mac Electron preview, then rebuild and validate the versioned Windows installer after approval.

### 2026-11-24 — M6b DONE: payroll review v2 and design-system alignment

- Done: reconciled every Markdown and HTML reference in `new payroll and design` using the v3 specification as the latest authority. Added documented payroll-v2 decisions, requirements, domain rules, UI specification, and shared design tokens. Implemented a pure integer-piastre engine for no deduction, exact minutes, configurable hours, any-lateness full day, threshold full day, and reason-required custom deductions; added independent overtime pricing by fixed hour or extra workday, per-date inclusion/override decisions, absence pricing, negative-result warnings, and immutable approval inputs/results. Rebuilt the bilingual Payroll screen around employee/month controls, day review and month-rule tabs, per-date explanations and overrides, separate lateness/overtime apply actions, KPI/summary totals, month-only salary override with an explicit optional employee-record update, printing, approval confirmation, and retained approval history. Bundled Cairo 500/700/800 locally for offline Arabic rendering and excluded the supplied static design-reference runtime bundles from source linting.
- Validation run (commands + result): ESLint PASS with 0 warnings; all strict TypeScript projects PASS; full Vitest PASS at 19 files and 116/116 tests; focused payroll engine/service PASS at 29/29 tests; production `electron-vite build` PASS for main, sandboxed preload, renderer, and bundled Cairo assets. The built Electron app was visually inspected in Arabic RTL and English LTR; evidence is stored in `docs/screenshots/m6b-payroll-ar.png`, `m6b-payroll-en.png`, and `m6b-payroll-rules-ar.png`.
- PENDING checks: repeat the final payroll workflow with real employee attendance and salary data on the target Windows PC, then rebuild the versioned Windows installer after owner approval. A payroll approval and an optional permanent employee-salary update are separately audited operations; if the second operation fails, the approved immutable run remains valid and the UI reports the employee update failure.
- Blockers / new open decisions: none for implementation. Real accounting policy values remain administrator choices; the app never silently chooses a deduction or overtime award.
- Next: owner reviews the Mac build with representative employee data, then complete Windows release acceptance and installer packaging.

### 2026-11-23 — M9a DONE: attendance rules v2

- Done: documented D-16–D-19 and ATT-8–ATT-11; added forward-only, data-preserving migration v7 for per-template late grace, checkout-open offset, overtime cap, and nullable/open-ended OUT zones. The pure attendance engine now keeps immutable raw rows while debouncing repeated scans within 300 seconds, reports ignored duplicate IDs, accepts measurable early checkout after IN, flags stays under 180 minutes as `SHORT_STAY`, applies whole-minute grace, prevents an open-ended OUT from consuming the next shift's IN, and calculates dated/monthly overtime. Attendance now returns actual and scheduled times, displays overtime and review flags in Arabic/English, explains `NOT_CLOSED`, and exposes the new template controls. Payroll calculation logic was not changed by M9a.
- Validation run (commands + result): attendance tests were written before implementation and initially failed in the seven expected rule areas. `CI=true pnpm check` PASS (ESLint 0 warnings, all workspace typechecks, 19 test files and 110/110 tests). `CI=true pnpm --filter @dawam/core test:coverage` PASS at 96.64% lines / 100% functions. `CI=true pnpm format:check` PASS. `CI=true pnpm build` PASS for Electron main, sandboxed CommonJS preload, and renderer. Migration tests prove a version-6 database retains its template ID and assignment while receiving the new defaults and passing `PRAGMA foreign_key_check`.
- PENDING checks: owner review of the refreshed Mac development UI; final Arabic/English visual QA and Windows target-PC upgrade/import checks remain part of release acceptance. The private real device export remains outside the repository; tests use sanitized/synthetic timestamp scenarios only.
- Blockers / new open decisions: D-16–D-19 remain OPEN with documented defaults so production values can be changed per template without rewriting raw punches.
- Next: collect owner feedback in the Mac preview, then include approved changes in the next versioned Windows installer.

### 2026-11-09 — M8 started: Windows x64 NSIS installer

- Done: added a guided per-user NSIS installer configuration for Windows x64 with a branded Dawam icon, selectable installation directory, desktop and Start menu shortcuts, ASAR packaging, deterministic artifact naming, and explicit preservation of application data during uninstall/upgrade. Added a root `pnpm dist:win` command with publishing disabled. Cross-built `Dawam-Setup-0.1.0-x64.exe` successfully from macOS and inspected the packaged ASAR for the main process, sandboxed preload, renderer, package metadata, and required Zod runtime dependency. Added a target-PC acceptance checklist covering installer hash verification, persistence, Arabic/English layout, exact device-ID entry, verified eFace 10 DAT import, duplicate safety, shared multi-admin data, encrypted backup/restore, and upgrade preservation.
- Validation run (commands + result): `CI=true pnpm format:check` PASS. `CI=true pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 19 test files / 99 tests passing. `CI=true pnpm build` PASS. `CI=true pnpm dist:win` PASS and created the final 118 MB x64 NSIS installer. Its SHA-256 is `810d8735487078fafda00658603f7f6330e509042596666e1eac065e9914a359`. ASAR inspection confirmed the main, preload, renderer, package metadata, and required Zod runtime are present.
- PENDING checks: clean installation and launch on the owner's Windows 10/11 x64 PC; SmartScreen handling for the currently unsigned test build; Arabic/English target-PC visual QA; USB import on that PC; Windows backup/restore round trip; and a real higher-version upgrade preserving saved data. The installer is not code-signed, so it is appropriate for owner testing but not yet a polished public distribution.
- Blockers / new open decisions: Windows version/architecture and target-PC results must be recorded. A commercial code-signing certificate is required later if public distribution without unknown-publisher warnings is desired.
- Next: run `docs/WINDOWS_RELEASE_CHECKLIST.md` on the target PC. After the clean-install result, build a higher-version upgrade test and confirm all saved data survives.

### 2026-11-09 — M4 real-device verification: eFace 10 six-column DAT

- Done: inspected the owner's real `1_attlog.dat` directly from the physical eFace 10. Confirmed ASCII with CRLF line endings, space-padded numeric device IDs, six tab-separated columns, and local wall-clock timestamps. The existing content detector parsed all 28/28 records with zero malformed rows, six distinct exact IDs (`1`, `2`, `3`, `4`, `5`, `7`), a minimum timestamp of `2026-11-08 20:37:44`, and a maximum of `2026-11-09 22:43:02`. No byte-identical duplicate line exists. Added a sanitized structure-preserving regression fixture and changed this exact `ZK_USB_6_COLUMN` shape to `VERIFIED_REAL_FIXTURE`; the import preview now shows a green verified eFace 10 badge. Device metadata fields remain informational and never decide first-IN/last-OUT.
- Validation run (commands + result): direct parser execution against the owner's original file PASS with 28 punches / 0 malformed. `CI=true pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 19 test files / 99 tests passing. The new structure-preserving real-format test verifies padded IDs, CRLF, exact timestamps, six columns, zero malformed rows, and the real-fixture badge. Existing service coverage continues to prove re-import idempotency, overlap handling, quarantine, resolution reuse, and transactional rollback. `CI=true pnpm format:check` PASS and `CI=true pnpm build` PASS for main, sandboxed preload, and renderer.
- PENDING checks: the supplied punches were deliberately random, so this file verifies byte parsing and ID/time extraction, not whether a controlled employee's expected IN/OUT pair produces a particular monthly status. Legacy `SSRTemplateS.xls` remains unverified. Windows target-PC USB acceptance remains deferred by the owner.
- Blockers / new open decisions: none for raw DAT import. The administrator must still confirm the actual export coverage period before import, so random test punches cannot create false absences outside that range.
- Next: run full regression/build, then the owner may preview this file in Dawam and map any currently unknown device IDs.

### 2026-11-09 — M7 local completion: encrypted recovery, audit viewer, idle lock, and hardening

- Done: added administrator-only AES-256-GCM encrypted `.dawam-backup` creation through a native folder picker using SQLite's online backup API. The archive contains the database, employee/admin photos, schema/app metadata, record counts, and SHA-256 checksums without exposing plaintext data. Added a native backup-file picker and staged restore flow with password authentication, archive/path/checksum validation, SQLite integrity and foreign-key checks, an automatic encrypted pre-restore safety backup, and an explicit close/reopen boundary before database replacement. Restored absolute photo paths are safely rewritten for the current data directory.
- Done: added a searchable administrator audit viewer, persisted 0/5/15/30/60-minute idle-session locking, Arabic/English backup/security UI and error text, administrator-only settings visibility for privileged actions, stricter CSP directives, and production startup-log redaction. Added complete Arabic and English user guides covering employees, exact device IDs, overnight shifts, coverage, import, attendance, payroll, accounts, backup/restore, and current acceptance limits.
- Validation run (commands + result): `CI=true pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 19 test files / 98 tests passing. New backup tests prove ciphertext does not expose an employee name, an online database/photo backup restores across a simulated restart, the pre-restore safety backup exists, integrity is preserved, and a wrong password cannot stage a restore. `CI=true pnpm build` PASS for Electron main, sandboxed CommonJS preload, and renderer. `CI=true pnpm format:check` PASS.
- PENDING checks: per the owner, the Windows installer, clean Windows 10/11 installation, upgrade-data preservation, Arabic/English target-PC layout, and USB import on the target PC remain intentionally deferred. The M7 Windows round-trip gate therefore remains pending even though the platform-independent local round-trip passes. Native eFace 10 raw DAT parsing is now verified in the newer entry above; legacy XLS remains unverified.
- Blockers / new open decisions: no local implementation blocker. Windows acceptance needs access to the target Windows PC; native-device verification needs the owner's sanitized file.
- Next: owner tests the new Settings backup/audit/lock controls locally. When ready, perform the deferred Windows release checklist and separately verify the real eFace 10 fixture.

### 2026-11-09 — Persistence QA: active database and saved media audit

- Done: copied and reopened the active `Dawam/dawam.sqlite` database independently of the UI and verified SQLite integrity, foreign keys, all applied migrations, saved administrators, employees, salaries, exact device IDs, shift assignments, weekly rests, teammate coverage, settings, payroll policies, and referenced profile/employee photos. Recomputed all 18 audit hashes from the stored canonical payloads and confirmed the full append-only chain is valid. Verified every referenced photo exists and has a valid JPEG/PNG/WebP signature.
- Validation run (commands + result): `PRAGMA integrity_check` returned `ok`; `PRAGMA foreign_key_check` returned zero rows; restart-read copy returned 2 users, 3 employees, and 3 assignments; audit verification returned valid with no broken row; four referenced photos exist and passed signature validation. `CI=true pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 18 test files / 96 tests passing.
- PENDING checks: no attendance import, raw punches, or approved payroll runs exist yet, which matches the current pre-device-test state. Encrypted backup/restore remains M7; Windows installer/target-PC acceptance remains M8; real eFace 10 export compatibility remains unverified until a sanitized export is supplied.
- Blockers / new open decisions: none. Current persisted records are internally consistent.
- Next: continue M7 backup/restore, then verify the first real eFace 10 import when available.

### 2026-11-09 — M3 follow-up: safe permanent deletion for mistaken employee records

- Done: added a visible permanent-delete action for inactive employees while retaining deactivate/reactivate as the normal historical workflow. Permanent deletion is allowed only for an employee created by mistake who has no leave/permission, resolved quarantined punch, manual correction, payroll run, or raw punch bearing that device ID. Active employees must first be deactivated. Successful deletion removes the unused employee, photo, and its unused schedule/rest/coverage configuration, writes an append-only audit event, refreshes the list, and frees the device ID; employees with operational history remain archived with a clear bilingual explanation.
- Validation run (commands + result): `CI=true pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 18 test files / 96 tests passing. New tests prove active deletion is rejected, an inactive unused record and its initial schedule can be deleted, an employee with operational leave history is protected, and the audit chain stays valid.
- PENDING checks: encrypted backup/restore and native Windows folder picker remain M7; Windows installer/target-PC acceptance remains M8; real eFace 10 export compatibility remains unverified until a sanitized device export is supplied.
- Blockers / new open decisions: login accounts remain deactivation-only because they are referenced by the immutable audit chain; employee deletion is intentionally limited to records with no operational history.
- Next: owner reopens the rebuilt app and verifies the two-step deactivate/delete workflow on a disposable employee, then continue M7 backup/restore.

### 2026-11-09 — M2/M7 follow-up: recoverable multi-administrator login

- Done: inspected the active local database and confirmed that both `Ahmed` and `Omar` are persisted, active administrator accounts with separate saved profile photos; the reported Ahmed login failure is therefore a credential mismatch rather than a missing account. Added an administrator-only password-reset flow in Settings, strong-password validation, login-lock reset, hash-chained audit logging without storing any password in the audit record, and an inline bilingual reset form. Clarified that login accounts are separate from employee/device records, relabeled the profile-photo panel as the currently signed-in account, added the saved-account count, named account-creation success feedback, visible password requirements, disabled saving states, and distinct green success/red error notices. Exposed the existing audited role/import-permission controls through an account editor so any administrator can manage another administrator or operator; the last active administrator and self-deactivation protections remain enforced. Added an explicit Settings explanation that all administrators share the same local employees, schedules, attendance, and payroll data.
- Validation run (commands + result): `CI=true pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 18 test files / 95 tests passing. New service coverage proves a weak reset is rejected, the old password stops working, the new password works, username matching remains case-insensitive, and the audit chain remains valid; IPC coverage exercises the reset route. `CI=true pnpm build` PASS for Electron main, sandboxed preload, and renderer. `CI=true pnpm format:check` PASS.
- PENDING checks: encrypted backup/restore and native Windows folder picker remain M7; Windows installer/target-PC acceptance remains M8; real eFace 10 export compatibility remains unverified until a sanitized device export is supplied.
- Blockers / new open decisions: none. Passwords cannot be recovered by design because only salted scrypt hashes are stored; another administrator can now set a replacement password safely.
- Next: owner reopens the rebuilt app, signs in as Omar, opens Settings, selects Set password for Ahmed, and verifies Ahmed login; then continue M7 backup/restore.

### 2026-11-09 — M3/M5/M6/M7 follow-up: account settings and per-date payroll review

- Done: made Settings functional with additional administrator/operator creation, safe account deactivation/reactivation, last-admin/self-deactivation protection, audit verification, and a persisted administrator profile photo. Added employee deactivate/reactivate actions that preserve historical attendance and payroll. Fixed the Home employee card to show the real total with the active count separately and refresh whenever the administrator returns to Home after employee changes; removed the carousel-like decorative indicator, made Schedule display-focused, and moved recurring shift/rest/coverage management to the employee form. Fixed Add Employee so it always opens blank and fixed an unassigned coverage teammate so it remains explicitly unassigned while editing. Attendance now prints the employee name/device ID/month and displays late and early time as hours/minutes. Payroll now shows employee identity and salary separately, lists every date, and stores a per-date exact-versus-round-up decision in the preview and immutable approval input snapshot; the table and summary expose actual and charged time independently.
- Done: simplified overnight shift creation: the next-day boundary is inferred automatically when the end clock is earlier than the start, the form displays Today/Next day badges and calculated duration, safe IN/OUT windows are generated around the shift, and the administrator can restore those recommendations after manual edits. For example, 1:00 PM to 1:00 AM is now shown explicitly as a 12-hour overnight shift with arrival around the start and departure around the next-day end.
- Validation run (commands + result): `CI=true pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 18 test files / 94 tests passing. New tests cover fixed-amount hour rounding, different exact/rounded decisions on separate dates, safe secondary-account deactivation, self-deactivation rejection, and profile-photo persistence. `CI=true pnpm build` PASS for Electron main, sandboxed preload, and renderer. Local Arabic RTL UI checks confirmed Settings navigation/content, the simplified payroll choices, a blank Add Employee form, and “no coverage teammate” selected by default.
- PENDING checks: encrypted backup/restore and native Windows folder picker remain M7; Windows installer/target-PC acceptance remains M8; real eFace 10 export compatibility remains unverified until a sanitized device export is supplied.
- Blockers / new open decisions: none for the implemented flow. Employee/admin “remove” is deliberately a reversible deactivation so historical attendance, approvals, and audit records cannot be orphaned.
- Next: finish M7 backup/restore and then M8 Windows packaging/acceptance.

### 2026-11-09 — M4 follow-up: explicit device-ID matching guidance

- Done: clarified beside the employee form that device IDs are preserved and matched exactly as exported, so `1` and `001` are not silently merged. Changed bridge-free demonstration employees from padded IDs to `1`, `2`, and `3`. Existing import quarantine and audited one-time resolution remain the safe fallback for an unknown exported ID.
- Validation run (commands + result): `pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 18 test files / 91 tests passing; existing import-service coverage proves exact known-ID matching, quarantine of unknown IDs, audited resolution, and reuse of that resolution on later imports. `pnpm format:check` PASS and production `pnpm build` PASS.
- PENDING checks: the owner's real eFace 10 export remains required before claiming verified native compatibility.
- Blockers / new open decisions: D-01/D-02 remain open until a sanitized device file exists.
- Next: M7 backup/restore and settings, followed by M8 Windows packaging.

### 2026-11-09 — M3 follow-up: complete schedule editing from the employee form

- Done: unified employee creation and editing so both expose normal shift, weekly day off, and optional coverage teammate. Editing now loads the employee's actual active schedule values, excludes the employee from their own teammate list, supports replacing or removing the teammate, and requires an effective-from date. Added one permission-checked schedule-profile API and a transactional update that versions shift, rest, and pair rules together, preserving earlier months and auditing every changed rule.
- Validation run (commands + result): `pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 18 test files / 91 tests passing. The new service test proves an initial shift/rest/pair profile, a future shift and rest change, teammate removal, and unchanged values before the effective date. `pnpm format:check` PASS and production `pnpm build` PASS for Electron main, sandboxed preload, and renderer.
- PENDING checks: Windows target-PC acceptance remains M8.
- Blockers / new open decisions: none.
- Next: continue M7 after owner review.

### 2026-11-09 — M3 follow-up: employee photo preview and saved avatars

- Done: replaced the raw browser file control with a bilingual employee-photo picker that previews the selected image before saving, shows the existing image while editing, supports replacing or cancelling a newly selected image, and crops display consistently with `object-fit: cover`. Added a permission-checked IPC photo reader so saved photos appear in the employee table without exposing local filesystem paths to the sandboxed renderer; initials remain the fallback when no photo exists.
- Validation run (commands + result): `pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 18 test files / 90 tests passing; the workforce service test now proves an authorized user can retrieve a stored photo while salary permissions remain enforced. `pnpm format:check` PASS and production `pnpm build` PASS for Electron main, sandboxed preload, and renderer.
- PENDING checks: optional interactive crop/reposition editing remains the existing EMP-3 should-have enhancement; current display uses a safe centered cover crop without modifying the original file.
- Blockers / new open decisions: none.
- Next: continue M7 after owner review.

### 2026-11-09 — M3/M5/M6 follow-up: simpler employee setup, attendance adjustments, and payroll choices

- Done: moved the employee's initial shift, recurring weekly rest day, and optional coverage teammate into the new-employee form, while retaining the Schedule screen for later recurring changes. Removed one-day exceptions from recurring scheduling and placed audited date adjustments beside the affected day in Monthly Attendance. Renamed ambiguous IN/OUT actions and columns to first check-in and last check-out. Replaced the advanced payroll-policy form with three clear choices: fixed EGP per late hour, one daily wage for each date reaching 60 late minutes, or no lateness deduction. Added per-date lateness/absence distribution so three hours on one date remain one threshold day while one hour on three dates becomes three threshold days. Added the fixed-hourly-amount core policy, bilingual UI strings, responsive styling, and module scroll reset.
- Validation run (commands + result): `pnpm check` PASS with ESLint 0 warnings, all strict workspace typechecks, and 18 test files / 90 tests passing; `pnpm format:check` PASS; production `pnpm build` PASS for Electron main, sandboxed preload, and renderer. Visual production checks were completed in Arabic RTL for the simplified payroll result and clarified monthly-attendance table; no visible form errors remained.
- PENDING checks: Windows 10/11 target-PC acceptance remains M8; native eFace 10 export remains unverified until a sanitized real device file is supplied.
- Blockers / new open decisions: none. Payroll only treats a missing employee as absent when a scheduled workday is fully covered by a confirmed USB import period.
- Next: M7 backup/restore, audit viewer, and hardening after owner review of this simplified workflow.

### 2026-11-09 — M6 DONE: payroll policies, preview, approval, and immutable history

- Done: added migration v4 indexes plus a database trigger that forbids changes to approved payroll snapshot identity, policy, inputs, result, approver, or approval time. Added versioned policy and payroll-run repositories; administrator-only service/IPC/preload operations for policy creation, explicit-policy preview, approval, history, void, and re-approval; and same-transaction hash-chained audit entries for every mutation. Connected monthly attendance to the pure payroll engine without copying or editing punches. Added a bilingual Payroll screen with all seven policy types, grace modes, scheduled/fixed hourly basis, daily/custom/no cap, absence multiplier, other approved deductions, custom tiers, explicit employee/month/policy selection, PREVIEW-not-approved banner, salary/deduction/net cards, per-date status/actual and billable late minutes/units/rule/cap/amount explanation, negative-net warning, required-reason approval, and retained void history.
- Validation run (commands + result): strict Electron main/preload and renderer TypeScript PASS; ESLint PASS with 0 warnings; Prettier repository check PASS; full Vitest PASS at 18 files and 88/88 tests; production `electron-vite build` PASS. Service tests prove EGP 6,000/30 = EGP 200 daily wage, 30-minute proportional deduction = 833 piastres, confirmed absence priced separately, explicit policy requirement, duplicate active approval rejection, approved result staying at the original EGP 6,000 after the employee salary changes to EGP 9,000, database-level snapshot mutation rejection, void/re-approve history, valid audit chain, and complete non-admin payroll denial. Existing core vectors continue to cover all seven policies and two independent 30-minute dates. Final isolated production preview rendered 30 payroll rows without errors; the synthetic EGP 6,000 case displayed EGP 5.56 lateness, EGP 400 absence, EGP 5,594.44 net, and UI approval created visible immutable history entry #1.
- PENDING checks: final Windows target-PC visuals and end-to-end installer run remain M8. A dedicated single-minute “live example” widget inside the policy editor is optional polish; full-month preview currently provides the authoritative live calculation before approval.
- Blockers / new open decisions: none. A policy is never silently selected, and preview remains distinct from approval.
- Next: M7 native backup/restore, pre-restore safety snapshot, audit viewer, idle lock, and security hardening.

### 2026-11-09 — M5 DONE: monthly attendance, corrections, and live home overview

- Done: added the monthly attendance repository/service over immutable raw punches, resolved quarantine mappings, confirmed import coverage, schedule resolution, matching, correction overlays, status calculation, and month summaries. Added permission-checked IPC and a bilingual Arabic RTL/English LTR month screen with employee/month filters, present/confirmed-absent/pending/late summaries, 30/31-day detail table, overnight punches, hours, late/early minutes, status labels, audited administrator IN/OUT correction, Excel-readable UTF-8 CSV export, and print/save-to-PDF layout. Replaced the misleading synthetic home totals and fixed shift cards with live employee, current-day attendance, lateness, review, and schedule group calculations. The home page now explicitly reports scheduled headcount; it no longer claims staffing coverage from demo numbers.
- Validation run (commands + result): strict Electron main/preload and renderer TypeScript PASS; ESLint PASS with 0 warnings; full Vitest PASS at 17 files and 85/85 tests; production `electron-vite build` PASS for main, CommonJS preload, and renderer. New service tests prove PRESENT/on-time, PRESENT/20-minutes-late, MISSING_OUT, confirmed ABSENT, PENDING_IMPORT outside coverage, immutable raw punches under audited correction, non-admin correction denial, next-day OUT attribution to the shift start date, and a 1000-punch month calculation under 1 second. Final production preview visually checked with an isolated synthetic profile: live home showed 1 employee/0 present/0 late/1 pending and one real scheduled shift; attendance rendered one table with 30 rows and no visible errors, including 2 present, 2 confirmed absent, 20 late minutes, missing OUT, pending-import, and not-closed states.
- PENDING checks: native `.xlsx` generation remains an ATT-7 should-have enhancement; the delivered Excel-readable CSV and Windows print/save-to-PDF flow cover current export needs. Real eFace 10 bytes and Windows target-PC behavior remain pending as previously recorded.
- Blockers / new open decisions: none. A missing punch becomes ABSENT only when the entire resolved shift window is inside confirmed import coverage; old months remain available indefinitely in the local database and can be selected from the month filter.
- Next: M6 payroll policy editor, per-date preview explanation, approval snapshot, void/re-approve, and admin-only salary enforcement.

### 2026-11-09 — M4 DONE (synthetic/unverified): USB import, coverage safety, and quarantine

- Done: implemented pure content-detected parsers for researched five-column ZKTeco text, six-column USB text, generic CSV, and generic JSON; preserved string device IDs, raw lines, line numbers, and metadata; handled BOM/CRLF/blank/trailing fields; collected malformed rows without discarding valid rows; and clearly rejected empty, over-10-MB, encrypted/binary, unknown, and still-unverified legacy XLS inputs. Added migration v3 and repositories for idempotent raw/quarantined punches, batches, and confirmed coverage. Added permission-checked import preview/commit services with SHA-256 batch identity, single-transaction writes, audit records, predicted new/duplicate/quarantine counts, repeat and overlapping-export safety, unknown-ID quarantine, and an audited resolution flow whose mapping is reused on later imports. Added a bilingual import wizard with file chooser, visible `UNVERIFIED` device badge, interpreted-row preview, malformed line numbers, explicit coverage-date confirmation, absence-safety warning, import summary, and employee matching for unknown IDs. Added synthetic DAT/CSV/JSON fixtures. Native eFace 10 bytes remain deliberately unclaimed until the owner provides a sanitized real export.
- Validation run (commands + result): direct strict TypeScript checks PASS for core, db, importers, Electron main/preload, and renderer; ESLint PASS with 0 warnings; Prettier check PASS; full Vitest PASS at 16 files and 80/80 tests; importer V8 coverage PASS at 94.07% lines / 100% functions (required ≥90% lines); production `electron-vite build` PASS for main, preload, and renderer. Tests prove same-file re-import = 0 new, overlapping export inserts only new punches, unknown IDs quarantine and resolve, resolved mappings work on later imports, permissions are enforced, malformed rows are reported, encrypted/binary/XLS inputs fail clearly, confirmed coverage is stored, audit verification passes, and an induced mid-import SQLite failure rolls the entire batch back.
- PENDING checks: real eFace 10 Attendance Data and `SSRTemplateS.xls` verification; device-specific native status/column confirmation; Windows 10/11 target-PC import; visual recheck of the final rebuilt import dialog after preview restart. Out-of-window classification belongs to M5 punch matching because it requires each employee's resolved schedule.
- Blockers / new open decisions: exact physical-device export bytes remain D-01/D-02. This does not block generic or visibly unverified synthetic imports.
- Next: M5 monthly attendance service/UI using the confirmed coverage and stored punches, with correction audit and XLSX/PDF export.

### 2026-11-09 — M2 follow-up: reliable first-run account creation

- Done: removed the misleading free-text backup path from first-run account creation; backup destination belongs in the M7 Settings/Backup screen and will use the native Windows folder picker. Added visible desktop-bridge and unexpected-error handling so setup can no longer fail silently. First-run now only collects the administrator credentials and fixed Cairo time zone. Fixed the production-only Electron bridge failure: the preload was first referenced with the wrong extension, then emitted as ESM despite sandbox constraints, and finally externalized Zod even though sandboxed preloads cannot resolve application packages. The preload now builds as CommonJS `index.cjs`, bundles Zod, and is referenced exactly by the BrowserWindow. Startup failures are logged and terminate cleanly instead of leaving a windowless process.
- Validation run (commands + result): desktop main/renderer strict TypeScript PASS; production Electron build PASS with bundled CommonJS preload; direct Chrome DevTools protocol assertion against a clean production profile returned `{"bridge":"object","hasAuth":"function"}`; ESLint PASS with 0 warnings; Prettier PASS; full Vitest PASS at 16 files and 80/80 tests; corrected normal isolated preview reopened.
- PENDING checks: owner click confirmation in the reopened preview; native Windows folder chooser arrives with the functional M7 backup workflow.
- Blockers / new open decisions: none.
- Next: continue M4 rather than treating the preview shell as a finished application.

### 2026-11-09 — M3 DONE: employees, shifts, scheduling, and coverage calendar

- Done: added migration v2 workforce-range indexes; durable employee, shift-template, assignment, weekly-rest, dated-override, teammate-pair, and leave repositories; admin-only audited workforce mutations with non-admin salary redaction; unique string device IDs; employee create/edit/deactivate flows; safe 5 MB JPEG/PNG/WebP signature validation and storage outside the install directory; seeded editable Morning and Evening templates; core-backed template/window validation; overlap rejection for assignments, rest rules, and active teammate pairs; immutable protection for templates already used by assignments; audited leave/permission and override operations; and a core-resolved monthly calendar with SHIFT, REST, COVERAGE, COVERAGE NEEDED, leave, permission, and override labels. Added strict Zod IPC validation and preload APIs for every operation. Added complete Arabic RTL and English LTR Employees, Shift Templates, and Schedule screens with photo selection, salary visibility restricted to admins, editing, month/employee selection, and planning forms.
- Validation run (commands + result): `pnpm check` PASS (ESLint 0 warnings, all workspace typechecks, 14 test files and 71/71 tests); `pnpm format:check` PASS; `pnpm build` PASS. M3 service tests prove duplicate device-ID rejection, photo signature checks, non-admin salary redaction and mutation denial, invalid-window rejection, assignment overlap rejection, safe template editing before use and historical-template protection after use, A-off→B merged coverage, both-off→COVERAGE_NEEDED, override cancellation, and future assignments leaving earlier dates unchanged. Production Electron smoke PASS after bundling both workspace packages; migration v2 created the SQLite/WAL files without runtime errors. The final renderer was visually checked on Employees, Shifts, and Schedule in Arabic RTL and English LTR; the Saturday-first calendar alignment and edit controls were rechecked after the final build.
- PENDING checks: Windows 10/11 target-PC launch remains M8. Photo crop/resize is an EMP-3 should-have enhancement and remains pending; original images are validated and stored safely now. Native eFace 10 export verification remains M4 pending a real file.
- Blockers / new open decisions: none. Templates referenced by any assignment are intentionally protected from in-place editing; admins create a new template and assign it only to future dates, which preserves historical results as required by SCH-3.
- Next: M4 import pipeline using the researched synthetic five-/six-column ZKTeco variants and synthetic SSR workbook, with explicit coverage confirmation, duplicate safety, quarantine, and a visible `UNVERIFIED` native-format badge.

### 2026-11-09 — M4 research note: eFace 10 USB export variants

- Done: confirmed the device family as ZKTeco eFace 10 from the owner's conversation and broadened format research across the official 2021/2022 manuals, ZKTeco's ZKBio Time FAQ, and observed ecosystem implementations. Documented two distinct USB paths: preferred raw `Attendance Data` (commonly `*_attlog.dat`) and the newer self-service `Report` path (`SSRTemplateS.xls` with schedule, statistical, attendance-record, exception, and card reports). Expanded the planned native parser to recognize researched five-/six-column text variants and the attendance-record sheet in legacy XLS, while treating terminal-calculated totals as informational only.
- Validation run (commands + result): documentation evidence cross-checked against both official eFace 10 manual generations; exact raw-file bytes remain deliberately unclaimed.
- PENDING checks: this unit's firmware/version, actual filename, raw column order, workbook sheet/header spelling, and encryption behavior require a real export. Native import stays visibly `UNVERIFIED` until a sanitized real fixture passes.
- Blockers / new open decisions: none for M3 or synthetic M4 development. Synthetic fixtures are authorized. D-01 is narrowed from unknown model to unknown eFace 10 firmware/export bytes; D-02 remains open.
- Next: continue M3, then implement the expanded synthetic M4 matrix and replace assumptions when the first real device file is available.

### 2026-11-09 — M2 DONE: durable local database, authentication, roles, and audited IPC

- Done: added a forward-only SQLite migration containing the application schema, foreign keys, constraints, indexes, schema versioning, WAL mode, and append-only audit triggers; implemented restart-safe repositories and deterministic transactions; added canonical JSON hash-chained audit events with verification and tamper detection; implemented first-run administrator creation, scrypt password hashing, login lockout, in-memory sessions, role and permission enforcement, last-administrator protection, persisted settings, and validated Zod IPC contracts across the renderer/preload/main boundary; connected the bilingual first-run and login screens to the real desktop API.
- Validation run (commands + result): `pnpm check` PASS (ESLint 0 warnings, all workspace typechecks, 13 test files and 66/66 tests); `pnpm format:check` PASS; `pnpm build` PASS; database tests PASS for migration/restart persistence, foreign keys, transactions, audit-chain verification, append-only enforcement, and tamper detection; service/IPC tests PASS for first-admin setup, password rules, lockout, session authorization, role boundaries, user creation, and last-admin protection. The packaged production Electron bundle launched with an isolated user-data directory and created `dawam.sqlite`, `dawam.sqlite-wal`, and `dawam.sqlite-shm` without runtime errors. The production renderer was visually checked in Arabic RTL and English LTR.
- PENDING checks: Windows 10/11 installation and target-PC launch remain M8; encrypted backup/restore remains M7; native device export parsing and real-device verification remain M4. Current import fixtures are synthetic as authorized by the owner.
- Blockers / new open decisions: none. ADR-3 is accepted: Electron 45's Node 24 runtime supplies built-in `node:sqlite`, avoiding native-addon rebuilds. D-01/D-02 remain open but do not block synthetic importer development.
- Next: M3 employee, team, shift-template, assignment, leave/permission, and monthly attendance-management UI over the durable service boundary.

### 2026-11-09 — M1 DONE: pure attendance and payroll domain core

- Done: implemented pure TypeScript core modules for Cairo wall-clock parsing with deterministic DST review flags; shift/window and adjacent-day validation; schedule precedence, weekly rest, dated overrides, approved leave/permission, teammate coverage and both-off coverage-needed handling; immutable raw-punch matching with first-IN/last-OUT, device-status independence, manual correction overlays, no double-use, late/early/hours calculations and outside-window review; confirmed import-coverage merging and absence safety; attendance status engine and month summaries; integer-piastre payroll calculation for all seven policies, both grace modes, scheduled/fixed hourly bases, per-date caps, custom rational tiers, absence lines, negative-net warnings, and per-date half-up rounding.
- Validation run (commands + result): `pnpm --filter @dawam/core test:coverage` PASS (9 files, 54 tests; lines 96.74%, functions 100%; required line gate ≥95%); `pnpm check` PASS (ESLint 0 warnings, all workspace typechecks, 54/54 tests); `pnpm format:check` PASS; `pnpm build` PASS. Property tests prove no raw punch is double-used and month/payroll totals equal the sum of dates. Fixtures cover Egypt DST start/end, overnight year/month boundaries, partial import coverage, both-off coverage, and DOMAIN_RULES payroll vectors.
- PENDING checks: native device export parsing remains M4 and explicitly UNVERIFIED; persistence/service integration begins in M2; UI/E2E proof for the vectors is M6.
- Blockers / new open decisions: none. D-01/D-02 remain open without blocking development; synthetic fixture data is used as authorized by the owner.
- Next: M2 local persistence, authentication, roles, validated IPC, settings, and append-only hash-chained audit.

### 2026-11-09 — M0 DONE: desktop workspace and bilingual shell

- Done: created the pnpm workspace (`packages/core`, `packages/db`, `packages/importers`, `apps/desktop`); added strict TypeScript, ESLint, Prettier, Vitest, Electron 45 + electron-vite + React 18; added a secure Electron main/preload boundary (`contextIsolation`, sandbox, no Node integration, blocked navigation/new windows); added an Arabic-first dashboard with complete English translations, persisted language selection, and RTL/LTR document switching; added synthetic/real fixture boundaries and exclusions for private data.
- Validation run (commands + result): `pnpm check` PASS (ESLint 0 warnings; all 4 workspace typechecks pass; Vitest 1/1 test pass); `pnpm format:check` PASS; `pnpm build` PASS (main, preload, and renderer production bundles); `pnpm dev` PASS through "starting electron app" with no runtime errors during the smoke interval; built renderer visually checked at 2560×768 in Arabic RTL and English LTR; reload confirmed persisted `lang=en` and `dir=ltr`.
- PENDING checks: Windows 10/11 target-PC launch and installer testing are deferred to M8; real device export verification remains required for M4.
- Blockers / new open decisions: none. ADR-3 remains intentionally deferred to M2, when persistence is implemented; native ZKTeco compatibility remains unclaimed.
- Next: M1 pure domain core, starting from the executable vectors in `DOMAIN_RULES.md` and `TEST_PLAN.md`.

### 2026-11-08 — M-pre: browser prototype (reference only)

- Done: `Attendance-Preview.html` offline prototype with Arabic views, monthly attendance from raw punches, payroll preview, sample JSON import (preview only, resets on reload).
- Validation run: JS syntax check; rule checks for late minutes, absence, missing punch, weekly rest, pending import, next-day checkout, 61-minute rounding.
- PENDING: real device export verification; everything in PLAN.md M0–M8.
- Notes: prototype is NOT the foundation; the pure rules should be re-implemented in `packages/core` from DOMAIN_RULES.md.

### 2026-11-08 — Docs v2

- Done: replaced REQUIREMENTS/IMPLEMENTATION with structured doc set (AGENTS, REQUIREMENTS, DOMAIN_RULES, ARCHITECTURE, DATA_MODEL, IMPORT_FORMATS, UI_SPEC, PLAN, TEST_PLAN, DECISIONS, AGENT_PROMPTS).
- PENDING: owner answers to OPEN items in DECISIONS.md; real device export.
