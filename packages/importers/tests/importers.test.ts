import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseAttendanceFile, summarizePunches } from '../src/index.js';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('attendance import parsers', () => {
  it('parses BOM/CRLF six-column USB text and preserves leading-zero IDs', () => {
    const parsed = parseAttendanceFile(
      bytes(
        '\uFEFF0007\t2026-10-31 08:03:14\t1\t0\t15\t0\r\n\r\n0007\t2026-10-31 22:01:00\t1\t1\t15\t0\t\r\n',
      ),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        format: 'ZK_USB_6_COLUMN',
        verification: 'VERIFIED_REAL_FIXTURE',
        minLocal: '2026-10-31 08:03:14',
        maxLocal: '2026-10-31 22:01:00',
      },
    });
    if (parsed.ok) {
      expect(parsed.value.punches).toHaveLength(2);
      expect(parsed.value.punches[0]).toMatchObject({
        deviceUserId: '0007',
        machineNumber: '1',
        verifyMode: '15',
      });
    }
  });

  it('matches the sanitized byte shape of the real eFace 10 1_attlog.dat export', () => {
    const parsed = parseAttendanceFile(
      bytes(
        '        3\t2026-11-08 20:37:44\t1\t0\t1\t0\r\n' +
          '        1\t2026-11-08 23:33:08\t1\t0\t0\t0\r\n' +
          '        7\t2026-11-09 22:43:02\t1\t0\t1\t0\r\n',
      ),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        format: 'ZK_USB_6_COLUMN',
        verification: 'VERIFIED_REAL_FIXTURE',
        minLocal: '2026-11-08 20:37:44',
        maxLocal: '2026-11-09 22:43:02',
        punches: [
          { deviceUserId: '3', lineNo: 1 },
          { deviceUserId: '1', lineNo: 2 },
          { deviceUserId: '7', lineNo: 3 },
        ],
        malformed: [],
      },
    });
  });

  it('parses five-column text while collecting malformed rows', () => {
    const parsed = parseAttendanceFile(
      bytes(
        '001\t2026-12-31 23:59:59\t0\t15\t0\n' +
          '002\t2027-01-01 00:00:00\t1\t15\t0\n' +
          '\t2026-02-01 10:00:00\t0\t15\t0\n' +
          '003\t2026-02-30 10:00:00\t0\t15\t0\n' +
          'too\tfew\tcolumns\n',
      ),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        format: 'ZK_RAW_5_COLUMN',
        punches: [{ deviceUserId: '001' }, { deviceUserId: '002' }],
      },
    });
    if (parsed.ok)
      expect(parsed.value.malformed.map((row) => row.reason)).toEqual([
        'EMPTY_USER_ID',
        'INVALID_TIMESTAMP',
        'INVALID_COLUMN_COUNT',
      ]);
  });

  it('parses generic CSV with aliases and quoted values', () => {
    const parsed = parseAttendanceFile(
      bytes('Employee ID,Timestamp,Status,Verify Mode\n"A,01",2026-11-09 10:00:00,0,15\n'),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { format: 'GENERIC_CSV', punches: [{ deviceUserId: 'A,01', deviceStatus: '0' }] },
    });
  });

  it('parses JSON and reports invalid records without dropping valid ones', () => {
    const parsed = parseAttendanceFile(
      bytes(
        JSON.stringify([
          { deviceUserId: '09', punchedAtLocal: '2026-11-09T12:30:00', verifyMode: 15 },
          null,
          { userId: '', timestamp: 'bad' },
        ]),
      ),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { format: 'GENERIC_JSON', punches: [{ deviceUserId: '09', verifyMode: '15' }] },
    });
    if (parsed.ok) expect(parsed.value.malformed).toHaveLength(2);
  });

  it('rejects empty, oversized, binary, OLE workbook, and unknown content clearly', () => {
    expect(parseAttendanceFile(new Uint8Array())).toMatchObject({ error: { code: 'EMPTY_FILE' } });
    expect(parseAttendanceFile(new Uint8Array(10 * 1024 * 1024 + 1))).toMatchObject({
      error: { code: 'FILE_TOO_LARGE' },
    });
    expect(parseAttendanceFile(Uint8Array.from([1, 0, 2]))).toMatchObject({
      error: { code: 'ENCRYPTED_OR_BINARY' },
    });
    expect(
      parseAttendanceFile(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toMatchObject({ error: { code: 'XLS_UNVERIFIED' } });
    expect(parseAttendanceFile(bytes('not attendance data'))).toMatchObject({
      error: { code: 'UNKNOWN_FORMAT' },
    });
  });

  it('summarizes padded-ID CRLF files per device ID with duplicates and 300 s repeats', () => {
    const parsed = parseAttendanceFile(
      bytes(
        '        3\t2026-11-08 08:00:00\t1\t0\t1\t0\r\n' +
          '        3\t2026-11-08 08:00:00\t1\t0\t1\t0\r\n' +
          '\t 3\t2026-11-08 08:05:00\t1\t0\t1\t0 \r\n' +
          '        3\t2026-11-08 08:10:01\t1\t0\t1\t0\r\n' +
          '        03\t2026-11-10 17:00:00\t1\t0\t1\t0\r\n' +
          '        7\tnot-a-date\t1\t0\t1\t0\r\n',
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.malformed).toEqual([
      expect.objectContaining({ lineNo: 6, reason: 'INVALID_TIMESTAMP' }),
    ]);
    expect(summarizePunches(parsed.value.punches)).toEqual({
      rowsValid: 5,
      exactDuplicates: 1,
      repeatedScans: 1,
      minLocal: '2026-11-08 08:00:00',
      maxLocal: '2026-11-10 17:00:00',
      daysCovered: 3,
      daysWithPunches: 2,
      byDeviceId: [
        {
          deviceUserId: '3',
          punchCount: 4,
          daysWithPunches: 1,
          firstLocal: '2026-11-08 08:00:00',
          lastLocal: '2026-11-08 08:10:01',
          exactDuplicates: 1,
          repeatedScans: 1,
        },
        expect.objectContaining({ deviceUserId: '03', punchCount: 1 }),
      ],
    });
  });
});

const repoFile = (relative: string): string =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
// Private real export: read in place only, never copied into the repository.
const realExport = repoFile('test data /1_attlog (1).dat');

const reportFor = (path: string) => {
  const parsed = parseAttendanceFile(readFileSync(path));
  if (!parsed.ok) throw new Error(parsed.error.code);
  const report = summarizePunches(parsed.value.punches);
  if (process.env.DAWAM_PRINT_IMPORT_REPORT) {
    console.log(JSON.stringify({ malformed: parsed.value.malformed.length, ...report }, null, 1));
  }
  return { parsed: parsed.value, report };
};

const countsById = (report: ReturnType<typeof summarizePunches>): Record<string, number> =>
  Object.fromEntries(report.byDeviceId.map((row) => [row.deviceUserId, row.punchCount]));

describe('attendance export files', () => {
  it('reads the synthetic November 2026 export for IDs 2-6 only', () => {
    const { parsed, report } = reportFor(
      repoFile('tests/fixtures/synthetic/attlog_november_2026_test.dat'),
    );
    expect(parsed.format).toBe('ZK_USB_6_COLUMN');
    expect(parsed.malformed).toEqual([]);
    expect(report.rowsValid).toBe(430);
    expect(report.byDeviceId.map((row) => row.deviceUserId).sort()).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it.skipIf(!existsSync(realExport))('reads the local real eFace 10 export when present', () => {
    const { parsed, report } = reportFor(realExport);
    expect(parsed.malformed).toEqual([]);
    expect(report.rowsValid).toBe(91);
    expect(countsById(report)).toEqual({ 1: 5, 2: 11, 3: 19, 4: 20, 5: 19, 6: 5, 7: 12 });
  });
});
