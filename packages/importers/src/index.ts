export type ImportVerification = 'SYNTHETIC' | 'VERIFIED_REAL_FIXTURE';

export interface NormalizedPunch {
  deviceUserId: string;
  punchedAtLocal: string;
  deviceStatus?: string;
  verifyMode?: string;
  workCode?: string;
  machineNumber?: string;
  rawLine: string;
  lineNo: number;
}

export interface MalformedImportRow {
  lineNo: number;
  rawLine: string;
  reason: 'EMPTY_USER_ID' | 'INVALID_TIMESTAMP' | 'INVALID_COLUMN_COUNT' | 'INVALID_RECORD';
}

export interface ParseResult {
  format: 'ZK_RAW_5_COLUMN' | 'ZK_USB_6_COLUMN' | 'GENERIC_CSV' | 'GENERIC_JSON';
  verification: ImportVerification;
  punches: readonly NormalizedPunch[];
  malformed: readonly MalformedImportRow[];
  minLocal?: string;
  maxLocal?: string;
}

export type ParseFailureCode =
  'EMPTY_FILE' | 'FILE_TOO_LARGE' | 'ENCRYPTED_OR_BINARY' | 'XLS_UNVERIFIED' | 'UNKNOWN_FORMAT';

export type ParseOutcome =
  { ok: true; value: ParseResult } | { ok: false; error: { code: ParseFailureCode } };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const localTimestamp = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

const normalizeTimestamp = (value: string): string | null => {
  const match = localTimestamp.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const maximumDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maximumDay) return null;
  return `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}:${secondText}`;
};

const result = (
  format: ParseResult['format'],
  punches: NormalizedPunch[],
  malformed: MalformedImportRow[],
  verification: ImportVerification = 'SYNTHETIC',
): ParseOutcome => {
  const times = punches.map((punch) => punch.punchedAtLocal).sort();
  return {
    ok: true,
    value: {
      format,
      verification,
      punches,
      malformed,
      ...(times[0] ? { minLocal: times[0] } : {}),
      ...(times.at(-1) ? { maxLocal: times.at(-1)! } : {}),
    },
  };
};

const parseRawText = (text: string): ParseOutcome | null => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const nonBlank = lines.filter((line) => line.trim().length > 0);
  if (nonBlank.length === 0 || !nonBlank.some((line) => line.includes('\t'))) return null;
  const widths = nonBlank.map((line) => line.split('\t').length);
  const sixColumn = widths.filter((width) => width >= 6).length > widths.length / 2;
  const format = sixColumn ? 'ZK_USB_6_COLUMN' : 'ZK_RAW_5_COLUMN';
  const punches: NormalizedPunch[] = [];
  const malformed: MalformedImportRow[] = [];
  lines.forEach((rawLine, index) => {
    if (!rawLine.trim()) return;
    const columns = rawLine.split('\t').map((column) => column.trim());
    const minimum = sixColumn ? 6 : 5;
    if (columns.length < minimum) {
      malformed.push({ lineNo: index + 1, rawLine, reason: 'INVALID_COLUMN_COUNT' });
      return;
    }
    const deviceUserId = columns[0] ?? '';
    if (!deviceUserId) {
      malformed.push({ lineNo: index + 1, rawLine, reason: 'EMPTY_USER_ID' });
      return;
    }
    const punchedAtLocal = normalizeTimestamp(columns[1] ?? '');
    if (!punchedAtLocal) {
      malformed.push({ lineNo: index + 1, rawLine, reason: 'INVALID_TIMESTAMP' });
      return;
    }
    const punch: NormalizedPunch = { deviceUserId, punchedAtLocal, rawLine, lineNo: index + 1 };
    if (sixColumn) {
      if (columns[2]) punch.machineNumber = columns[2];
      if (columns[3]) punch.deviceStatus = columns[3];
      if (columns[4]) punch.verifyMode = columns[4];
      if (columns[5]) punch.workCode = columns[5];
    } else {
      if (columns[2]) punch.deviceStatus = columns[2];
      if (columns[3]) punch.verifyMode = columns[3];
      if (columns[4]) punch.workCode = columns[4];
    }
    punches.push(punch);
  });
  return result(format, punches, malformed, sixColumn ? 'VERIFIED_REAL_FIXTURE' : 'SYNTHETIC');
};

const csvRow = (line: string): string[] => {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
};

const fieldIndex = (headers: readonly string[], aliases: readonly string[]): number =>
  headers.findIndex((header) => aliases.includes(header.toLowerCase().replace(/[ _-]/g, '')));

const parseCsv = (text: string): ParseOutcome | null => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headerLine = lines.find((line) => line.trim());
  if (!headerLine || !headerLine.includes(',')) return null;
  const headers = csvRow(headerLine);
  const userIndex = fieldIndex(headers, ['deviceuserid', 'userid', 'employeeid', 'id']);
  const timeIndex = fieldIndex(headers, ['punchedatlocal', 'punchtime', 'timestamp', 'datetime']);
  if (userIndex < 0 || timeIndex < 0) return null;
  const statusIndex = fieldIndex(headers, ['devicestatus', 'status', 'state']);
  const verifyIndex = fieldIndex(headers, ['verifymode', 'verify']);
  const workIndex = fieldIndex(headers, ['workcode']);
  const machineIndex = fieldIndex(headers, ['machinenumber', 'machineno']);
  const headerNumber = lines.indexOf(headerLine) + 1;
  const punches: NormalizedPunch[] = [];
  const malformed: MalformedImportRow[] = [];
  lines.slice(headerNumber).forEach((rawLine, offset) => {
    if (!rawLine.trim()) return;
    const lineNo = headerNumber + offset + 1;
    const values = csvRow(rawLine);
    const deviceUserId = values[userIndex]?.trim() ?? '';
    const punchedAtLocal = normalizeTimestamp(values[timeIndex] ?? '');
    if (!deviceUserId) {
      malformed.push({ lineNo, rawLine, reason: 'EMPTY_USER_ID' });
      return;
    }
    if (!punchedAtLocal) {
      malformed.push({ lineNo, rawLine, reason: 'INVALID_TIMESTAMP' });
      return;
    }
    const punch: NormalizedPunch = { deviceUserId, punchedAtLocal, rawLine, lineNo };
    const optional = (index: number): string | undefined =>
      index >= 0 && values[index] ? values[index] : undefined;
    const deviceStatus = optional(statusIndex);
    const verifyMode = optional(verifyIndex);
    const workCode = optional(workIndex);
    const machineNumber = optional(machineIndex);
    if (deviceStatus) punch.deviceStatus = deviceStatus;
    if (verifyMode) punch.verifyMode = verifyMode;
    if (workCode) punch.workCode = workCode;
    if (machineNumber) punch.machineNumber = machineNumber;
    punches.push(punch);
  });
  return result('GENERIC_CSV', punches, malformed);
};

const parseJson = (text: string): ParseOutcome | null => {
  if (!text.trimStart().startsWith('[')) return null;
  let records: unknown;
  try {
    records = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(records)) return null;
  const punches: NormalizedPunch[] = [];
  const malformed: MalformedImportRow[] = [];
  records.forEach((record, index) => {
    const rawLine = JSON.stringify(record);
    const lineNo = index + 1;
    if (!record || typeof record !== 'object') {
      malformed.push({ lineNo, rawLine, reason: 'INVALID_RECORD' });
      return;
    }
    const item = record as Record<string, unknown>;
    const deviceUserId = String(item.deviceUserId ?? item.userId ?? '').trim();
    const punchedAtLocal = normalizeTimestamp(String(item.punchedAtLocal ?? item.timestamp ?? ''));
    if (!deviceUserId) {
      malformed.push({ lineNo, rawLine, reason: 'EMPTY_USER_ID' });
      return;
    }
    if (!punchedAtLocal) {
      malformed.push({ lineNo, rawLine, reason: 'INVALID_TIMESTAMP' });
      return;
    }
    const punch: NormalizedPunch = { deviceUserId, punchedAtLocal, rawLine, lineNo };
    for (const [key, target] of [
      ['deviceStatus', 'deviceStatus'],
      ['verifyMode', 'verifyMode'],
      ['workCode', 'workCode'],
      ['machineNumber', 'machineNumber'],
    ] as const) {
      const value = item[key];
      if (value !== undefined && value !== null && String(value)) punch[target] = String(value);
    }
    punches.push(punch);
  });
  return result('GENERIC_JSON', punches, malformed);
};

export const parseAttendanceFile = (bytes: Uint8Array): ParseOutcome => {
  if (bytes.byteLength === 0) return { ok: false, error: { code: 'EMPTY_FILE' } };
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, error: { code: 'FILE_TOO_LARGE' } };
  if (
    bytes.length >= 8 &&
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value)
  ) {
    return { ok: false, error: { code: 'XLS_UNVERIFIED' } };
  }
  if (bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)) {
    return { ok: false, error: { code: 'ENCRYPTED_OR_BINARY' } };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return (
    parseJson(text) ??
    parseCsv(text) ??
    parseRawText(text) ?? { ok: false, error: { code: 'UNKNOWN_FORMAT' } }
  );
};
