import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import {
  AuditRepository,
  type Clock,
  type DawamDatabase,
  ImportRepository,
  systemClock,
  WorkforceRepository,
} from '@dawam/db';
import {
  parseAttendanceFile,
  type NormalizedPunch,
  type ParseFailureCode,
  type ParseResult,
} from '../../../../../packages/importers/src/index.js';

import type { AuthService } from './auth-service.js';
import type { ServiceResult } from './service-result.js';

export interface ImportFileInput {
  filename: string;
  dataBase64: string;
  deviceSerial?: string;
}

export interface CommitImportInput extends ImportFileInput {
  coverageFrom: string;
  coverageTo: string;
  coverageConfirmed: true;
}

export interface ImportPreview {
  filename: string;
  format: ParseResult['format'];
  verification: ParseResult['verification'];
  rowsTotal: number;
  rowsValid: number;
  rowsMalformed: number;
  predictedNew: number;
  predictedDuplicate: number;
  predictedQuarantined: number;
  minLocal?: string;
  maxLocal?: string;
  sample: readonly NormalizedPunch[];
  malformed: ParseResult['malformed'];
}

export interface ImportCommitSummary {
  batchId: number;
  rowsTotal: number;
  rowsNew: number;
  rowsDuplicate: number;
  rowsQuarantined: number;
  rowsMalformed: number;
}

export interface QuarantinedPunchView {
  id: number;
  deviceUserId: string;
  punchedAtLocal: string;
}

export interface ImportServiceError {
  code: string;
  messageKey: string;
}

const serviceError = (code: string): ImportServiceError => ({
  code,
  messageKey: `errors.import_${code.toLowerCase()}`,
});

const decodedFile = (
  input: ImportFileInput,
): ServiceResult<{ bytes: Buffer; filename: string; deviceSerial: string }, ImportServiceError> => {
  const filename = basename(input.filename.trim());
  if (!filename || filename === '.' || filename === '..') {
    return { ok: false, error: serviceError('INVALID_FILENAME') };
  }
  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (!input.dataBase64 || bytes.length === 0) {
    return { ok: false, error: serviceError('EMPTY_FILE') };
  }
  return {
    ok: true,
    value: { bytes, filename, deviceSerial: input.deviceSerial?.trim() ?? '' },
  };
};

const parserError = (code: ParseFailureCode): ImportServiceError => serviceError(code);

export class ImportService {
  private readonly imports: ImportRepository;
  private readonly workforce: WorkforceRepository;
  private readonly audit: AuditRepository;

  constructor(
    private readonly database: DawamDatabase,
    private readonly auth: AuthService,
    private readonly clock: Clock = systemClock,
  ) {
    this.imports = new ImportRepository(database);
    this.workforce = new WorkforceRepository(database);
    this.audit = new AuditRepository(database, clock);
  }

  preview(input: ImportFileInput): ServiceResult<ImportPreview, ImportServiceError> {
    const actor = this.auth.authorize('import.run');
    if (!actor.ok) return actor;
    const decoded = decodedFile(input);
    if (!decoded.ok) return decoded;
    const parsed = parseAttendanceFile(decoded.value.bytes);
    if (!parsed.ok) return { ok: false, error: parserError(parsed.error.code) };
    let predictedNew = 0;
    let predictedDuplicate = 0;
    let predictedQuarantined = 0;
    for (const punch of parsed.value.punches) {
      const known =
        this.workforce.findEmployeeByDeviceId(punch.deviceUserId) ??
        this.imports.resolvedEmployeeForDeviceId(punch.deviceUserId);
      if (!known) {
        if (this.imports.hasQuarantined(punch.deviceUserId, punch.punchedAtLocal)) {
          predictedDuplicate += 1;
        } else predictedQuarantined += 1;
      } else if (
        this.imports.hasPunch(decoded.value.deviceSerial, punch.deviceUserId, punch.punchedAtLocal)
      ) {
        predictedDuplicate += 1;
      } else predictedNew += 1;
    }
    return {
      ok: true,
      value: {
        filename: decoded.value.filename,
        format: parsed.value.format,
        verification: parsed.value.verification,
        rowsTotal: parsed.value.punches.length + parsed.value.malformed.length,
        rowsValid: parsed.value.punches.length,
        rowsMalformed: parsed.value.malformed.length,
        predictedNew,
        predictedDuplicate,
        predictedQuarantined,
        ...(parsed.value.minLocal ? { minLocal: parsed.value.minLocal } : {}),
        ...(parsed.value.maxLocal ? { maxLocal: parsed.value.maxLocal } : {}),
        sample: parsed.value.punches.slice(0, 10),
        malformed: parsed.value.malformed.slice(0, 50),
      },
    };
  }

  commit(input: CommitImportInput): ServiceResult<ImportCommitSummary, ImportServiceError> {
    const actor = this.auth.authorize('import.run');
    if (!actor.ok) return actor;
    if (input.coverageFrom > input.coverageTo) {
      return { ok: false, error: serviceError('INVALID_COVERAGE') };
    }
    const decoded = decodedFile(input);
    if (!decoded.ok) return decoded;
    const parsed = parseAttendanceFile(decoded.value.bytes);
    if (!parsed.ok) return { ok: false, error: parserError(parsed.error.code) };
    const summary = this.database.transaction(() => {
      const batchId = this.imports.createBatch({
        filename: decoded.value.filename,
        sha256: createHash('sha256').update(decoded.value.bytes).digest('hex'),
        format: parsed.value.format,
        ...(decoded.value.deviceSerial ? { deviceSerial: decoded.value.deviceSerial } : {}),
        importedAt: this.clock.now().toISOString(),
        importedBy: actor.value.id,
      });
      this.imports.addCoverage(batchId, input.coverageFrom, input.coverageTo, true);
      let rowsNew = 0;
      let rowsDuplicate = 0;
      let rowsQuarantined = 0;
      for (const punch of parsed.value.punches) {
        const stored = {
          batchId,
          deviceUserId: punch.deviceUserId,
          punchedAtLocal: punch.punchedAtLocal,
          ...(punch.deviceStatus ? { deviceStatus: punch.deviceStatus } : {}),
          ...(punch.verifyMode ? { verifyMode: punch.verifyMode } : {}),
          rawLine: punch.rawLine,
        };
        const known =
          this.workforce.findEmployeeByDeviceId(punch.deviceUserId) ??
          this.imports.resolvedEmployeeForDeviceId(punch.deviceUserId);
        if (!known) {
          if (this.imports.insertQuarantined(stored)) rowsQuarantined += 1;
          else rowsDuplicate += 1;
        } else if (
          this.imports.insertPunch({ ...stored, deviceSerial: decoded.value.deviceSerial })
        ) {
          rowsNew += 1;
        } else rowsDuplicate += 1;
      }
      const rowsTotal = parsed.value.punches.length + parsed.value.malformed.length;
      this.imports.finishBatch(batchId, {
        rowsTotal,
        rowsNew,
        rowsDuplicate,
        rowsQuarantined,
        rowsMalformed: parsed.value.malformed.length,
      });
      const value: ImportCommitSummary = {
        batchId,
        rowsTotal,
        rowsNew,
        rowsDuplicate,
        rowsQuarantined,
        rowsMalformed: parsed.value.malformed.length,
      };
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'attendance.import_committed',
        entity: 'import_batch',
        entityId: String(batchId),
        after: value,
        reason: 'confirmed_usb_import',
      });
      return value;
    });
    return { ok: true, value: summary };
  }

  listQuarantined(): ServiceResult<readonly QuarantinedPunchView[], ImportServiceError> {
    const actor = this.auth.authorize('import.run');
    if (!actor.ok) return actor;
    return {
      ok: true,
      value: this.imports.listUnresolvedQuarantined().map((punch) => ({
        id: punch.id,
        deviceUserId: punch.deviceUserId,
        punchedAtLocal: punch.punchedAtLocal,
      })),
    };
  }

  resolveQuarantined(input: {
    quarantineId: number;
    employeeId: number;
    reason: string;
  }): ServiceResult<true, ImportServiceError> {
    const actor = this.auth.authorize('import.run');
    if (!actor.ok) return actor;
    const punch = this.imports.findQuarantined(input.quarantineId);
    if (!punch || punch.resolvedEmployeeId !== null) {
      return { ok: false, error: serviceError('QUARANTINE_NOT_FOUND') };
    }
    const employee = this.workforce.findEmployee(input.employeeId);
    if (!employee) return { ok: false, error: serviceError('EMPLOYEE_NOT_FOUND') };
    this.database.transaction(() => {
      this.imports.resolveQuarantined(
        input.quarantineId,
        employee.id,
        this.clock.now().toISOString(),
      );
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'attendance.quarantine_resolved',
        entity: 'quarantined_punch',
        entityId: String(punch.id),
        after: {
          deviceUserId: punch.deviceUserId,
          punchedAtLocal: punch.punchedAtLocal,
          employeeId: employee.id,
        },
        reason: input.reason,
      });
    });
    return { ok: true, value: true };
  }
}
