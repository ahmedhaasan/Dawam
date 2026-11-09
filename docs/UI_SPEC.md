# UI spec

## Global

- Left/right sidebar flips with direction (RTL: sidebar on the right). Language toggle in header, persisted.
- Use CSS logical properties; mirror directional icons (arrows, chevrons); don't mirror clocks/logos.
- Numerals: Western digits by default (setting for Arabic-Indic). Dates: show Gregorian; weekday names localized. Week starts Saturday option (setting; Egypt default Saturday).
- Every string is an i18n key `area.screen.element`. No hard-coded text.
- States for every screen: loading, empty, error, permission denied.
- Destructive/approval actions use confirm dialogs with a required reason where audit demands it.

## Screens

1. **First-run setup**: language, create admin (username, password with strength meter), backup folder, timezone (default Africa/Cairo).
2. **Login / lock**.
3. **Home (Import)**: big drop zone "Import from USB file", last import info, coverage timeline strip (which dates are confirmed), alerts (quarantine count, coverage needed days, REVIEW punches).
4. **Import wizard**: steps in IMPORT_FORMATS. Shows malformed lines, duplicate count, coverage confirmation.
5. **Quarantine**: unknown device IDs grouped; actions: map to employee / create employee / ignore (with audit).
6. **Employees**: list with photo, name, device ID, status; add/edit drawer; salary fields visible to admin only.
7. **Shifts**: templates table with windows editor (time pickers supporting "+1 day"); validation messages for overlaps.
8. **Schedule**: month calendar per employee and team grid; chips: shift name, REST, COVERAGE, LEAVE, OVERRIDE, COVERAGE NEEDED (red). Click a day → override dialog (reason). Pair manager. Weekly rest editor.
9. **Monthly attendance**: employee + month selector; table columns per ATT-1; status badges with colours AND text/icons (not colour-only); row click → detail drawer showing raw punches, matched IN/OUT, corrections, audit trail; month summary header cards. Filter by status.
10. **Corrections / Leave**: dialogs with reason (required).
11. **Payroll preview** (admin): choose employee and month, then choose one plain-language method: fixed EGP per late hour, one daily wage for each date reaching 60 late minutes, or no late deduction. Show salary, daily wage, total late time and affected dates, absence days, deductions, and net. Separate approval stores an immutable snapshot.
12. **Advanced policies**: kept in the engine and audit history, not exposed in the normal monthly workflow.
13. **Users & permissions** (admin): create users, grant/revoke admin (cannot remove last admin).
14. **Audit log** (admin): filter by date/user/entity; verify-chain button.
15. **Backup & restore** (admin): create, list, verify, restore with warnings; last backup date.
16. **Settings**: language, numerals, week start, lockout, idle lock.

## UX quality bar

- Month table usable at 1366×768 and 1920×1080; sticky header; keyboard navigation.
- Print/export-friendly month report (ATT-7) in both languages.
- Errors show human message + code; never raw stack traces.
