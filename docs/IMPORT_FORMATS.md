# Import formats

## Verification status

- Device family: **ZKTeco eFace 10**, confirmed from the owner's device conversation.
- The physical unit's raw `1_attlog.dat` byte shape is **VERIFIED** from the owner's 2026-11-09 export. It contains CRLF-terminated, tab-separated six-column records with space-padded numeric IDs and local timestamps.
- The specific firmware version and self-service `SSRTemplateS.xls` shape remain **UNVERIFIED**. Generic/synthetic formats retain their separate verification labels.

Research refreshed 2026-11-09 against the official 2021 and 2022 eFace 10 manuals, ZKTeco's ZKBio Time FAQ, and observed ZKTeco importer/protocol implementations. The manuals prove the workflows and workbook names, but they do not publish the raw attendance file's byte-level column contract.

## The device has two different USB export paths

### A. Raw attendance data — preferred for Dawam

Device: **Main Menu → USB Manager → Download → Attendance Data → choose the date range**.

In **USB Manager → Download Options**:

- Turn **Encrypt Attendance Data OFF**. If it is on, Dawam must reject the file with a clear instruction; it must not guess a key.
- Keep **Delete ATT Data OFF** so exporting does not erase the device history.

Common filenames are `1_attlog.dat`, `attlog.dat`, or `<device-serial>_attlog.dat`, but filename and extension are only hints. Detection must use file content.

This is the best source for Dawam because it contains individual punches and does not depend on the device's own shift/payroll calculations.

### B. Self-service attendance workbook — supported fallback

Some 2022 eFace 10 firmware includes **Main Menu → Report → Download Att. Report**. The user selects start and end dates and the device writes:

`SSRTemplateS.xls`

The official manual shows that this workbook contains these reports/sheets:

- Schedule Information Report
- Statistical Report of Attendance
- Attendance Record Report
- Exception Statistic Report
- Card Report

The Statistical Report includes fields such as ID, name, department, normal/real work hours, late count/minutes, early-leave count/minutes, overtime, attendance days, absence, additions, deductions, and real pay. Dawam must **not** trust those calculated totals as its own result because they depend on schedules and policies configured on the terminal.

For importing punches, Dawam may read the workbook's **Attendance Record Report** as a fallback and show a preview. Raw `Attendance Data` remains preferred. `AttSettingE.xls` / `Setting Report.xls` is a schedule-configuration workbook, not a punch import.

Older 2021 eFace 10 firmware documentation has USB Manager but no self-service Report chapter, so M4 must not require `SSRTemplateS.xls` to exist.

## Raw shapes

### Verified eFace 10 USB six-column layout

Tab-separated, one punch per line:

```text
<space-padded UserID>\t<YYYY-MM-DD HH:mm:ss>\t<Field3>\t<Field4>\t<Field5>\t<Field6>
```

Example synthetic line:

```text
        7\t2026-11-09 22:43:02\t1\t0\t1\t0
```

The supplied file parsed as `ZK_USB_6_COLUMN`: 28/28 valid rows, no malformed records, IDs `1`, `2`, `3`, `4`, `5`, and `7`, and timestamps from `2026-11-08 20:37:44` through `2026-11-09 22:43:02`. The owner confirmed these were random device tests, so they verify parsing—not real attendance outcomes.

The meanings of fields 3–6 are intentionally treated as raw metadata. In the supplied file field 3 was always `1`, field 4 always `0`, field 5 was `0` or `1`, and field 6 always `0`. First-check-in/last-check-out matching does not depend on those device codes.

### Common ADMS-like five-column layout (still synthetic)

Some exports and software-generated files use:

```text
<UserID>\t<YYYY-MM-DD HH:mm:ss>\t<Status>\t<VerifyMode>\t<WorkCode>
```

Columns after the employee ID and timestamp vary between model families and firmware. M4 must detect candidate layouts, display the interpreted columns in preview, and never silently reinterpret an ambiguous file.

- Keep UserID as a string and trim whitespace only; leading zeroes may matter for mapping.
- Store status/state, verification mode, work code, and machine number as raw metadata.
- Do not depend on device status for first-IN/last-OUT matching.
- Verification codes are not stable enough to drive attendance logic. Face is commonly observed as `15`, but this is metadata only.
- Timestamps usually have no timezone. Treat them as device-local wall-clock time (`Africa/Cairo`) and warn about future timestamps or clock jumps.
- Accept BOM, CRLF/LF, trailing tabs, blank lines, and documented five-/six-column variants.

## Parser contract

```ts
interface NormalizedPunch {
  deviceUserId: string;
  punchedAtLocal: string;
  deviceStatus?: string;
  verifyMode?: string;
  workCode?: string;
  machineNumber?: string;
  rawLine: string;
  lineNo: number;
}
interface ParseResult {
  format: string;
  verification: 'SYNTHETIC' | 'VERIFIED_REAL_FIXTURE';
  deviceSerial?: string;
  punches: NormalizedPunch[];
  malformed: { lineNo: number; rawLine: string; reason: string }[];
  minLocal?: string;
  maxLocal?: string;
}
```

- Parsers are pure: input bytes → `ParseResult`.
- Detect format by content, not extension; reject unknown content clearly.
- Never throw because one row is bad; collect it in `malformed`.
- Detect encrypted/binary attendance data and explain how to export again with encryption off.
- For legacy `.xls`, validate the OLE container, cap file/row sizes, and select sheets by normalized header signatures rather than sheet position alone.
- If five-/six-column raw layouts are ambiguous, require user confirmation in preview and retain the raw row.

## Import wizard

1. Pick file → show detected format, verification badge, row count, min/max time, malformed count, and the first interpreted rows.
2. User confirms the device/source and **coverage period**. File min/max timestamps are only hints.
3. Preview new / duplicate / quarantined unknown IDs / suspicious timestamps and column interpretation.
4. Commit in one transaction, append an audit event, and show the summary with a quarantine link.

## Fixtures

Synthetic M4 fixtures must cover:

- five-column ADMS-like raw text;
- six-column USB raw text with machine number;
- BOM, CRLF/LF, blank lines, trailing fields, leading-zero IDs;
- malformed/future times, unknown IDs, clock jumps;
- same-second duplicates, overlap, 23:59:59/00:00:00, overnight and year boundary;
- a structurally valid synthetic `SSRTemplateS.xls` containing recognizable report sheets;
- encrypted/binary and unrelated-workbook rejection.

Additional device verification later may include:

- a controlled file with one known IN/OUT pair and one overnight pair for end-to-end attendance expectation confirmation;
- if the device has **Report**, the original `SSRTemplateS.xls` too;
- a second export overlapping the first to prove idempotency;
- written expected IDs/times, followed by sanitization that preserves structure byte-for-byte.

## Sources and confidence boundaries

- Official eFace 10 2022 manual: <https://zkteco.eu/sites/default/files/content/downloads/eface10-user-manual-v1.0-20220120.pdf>
- Official/regional eFace 10 2021 manual: <https://zkteco.sa/download-file/2921>
- Official ZKTeco FAQ (USB import into ZKBio Time): <https://www.zkteco.com/en/faq>

The official manuals confirm the two device menus, date-range exports, encryption/delete options, and workbook names/content. The six-column raw DAT byte layout is now verified against this physical eFace 10 unit. Five-column and legacy XLS variants remain deliberately unverified for this unit.

## Future (out of v1)

Direct device pull (ZK protocol port 4370 / ADMS push) can be added through a separate `DeviceSource` adapter producing `NormalizedPunch[]`.
