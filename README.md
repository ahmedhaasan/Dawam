# Dawam (دوام) — Offline Attendance & Payroll-Preview Desktop App

Windows desktop app that imports attendance punches exported by a ZKTeco face/fingerprint device via USB,
applies shift/coverage rules, produces monthly attendance, and previews payroll deductions. Offline-first, Arabic RTL default, English switchable.

## Read order (humans and AI agents)

1. `AGENTS.md` — working rules. Mandatory first read for any agent.
2. `docs/REQUIREMENTS.md` — what to build (numbered requirements).
3. `docs/DOMAIN_RULES.md` — exact attendance and payroll logic + test vectors.
4. `docs/ARCHITECTURE.md` — stack, layers, security, backup.
5. `docs/DATA_MODEL.md` — SQLite schema.
6. `docs/IMPORT_FORMATS.md` — device export formats (unverified until real file arrives).
7. `docs/UI_SPEC.md` — screens and i18n.
8. `docs/PLAN.md` — milestones M0–M8 with acceptance gates.
9. `docs/TEST_PLAN.md` — test strategy and release checklist.
10. `docs/DECISIONS.md` — open decisions (owner must answer) and accepted ADRs.
11. `docs/AGENT_PROMPTS.md` — copy-paste prompt per milestone.
12. `IMPLEMENTATION.md` — running log. Updated in every change.

## Current status

See `IMPLEMENTATION.md`. Existing `Attendance-Preview.html` is a throwaway reference prototype, not the foundation.

## Interim option (no custom code)

The device can also be used with ZKBio Time/BioTime via USB upload (Device → Data → Transaction → Upload USB Transaction).
Dawam exists because custom deduction policies, coverage pairs and audit trail are needed beyond that.
