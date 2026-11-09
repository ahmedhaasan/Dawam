import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  isValidLocalDate,
  resolveSchedule,
  validateShiftTemplate,
  type ScheduleContext,
  type ScheduleOverrideKind,
} from '@dawam/core';
import {
  AuditRepository,
  type Clock,
  type DawamDatabase,
  type EmployeeRecord,
  type ShiftTemplateRecord,
  systemClock,
  WorkforceRepository,
} from '@dawam/db';

import type { AuthService, SessionUser } from './auth-service.js';
import type { ServiceResult } from './service-result.js';

export interface EmployeeView {
  id: number;
  fullName: string;
  deviceUserId: string;
  hasPhoto: boolean;
  hireDate: string | null;
  active: boolean;
  monthlySalaryMinor?: number | null;
  wageBasisDays?: number;
}

export interface EmployeeInput {
  fullName: string;
  deviceUserId: string;
  hireDate?: string | null;
  active: boolean;
  monthlySalaryMinor?: number | null;
  wageBasisDays: number;
  photo?: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; dataBase64: string };
  reason: string;
}

export interface EmployeePhotoView {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  dataBase64: string;
}

export interface EmployeeScheduleProfile {
  templateId: number | null;
  weekday: number | null;
  partnerId: number | null;
}

export interface TemplateInput {
  name: string;
  active: boolean;
  startMin: number;
  endMin: number;
  inFromMin: number;
  inToMin: number;
  outFromMin: number;
  outToMin: number;
  reason: string;
}

export interface CalendarDay {
  date: string;
  kind: 'SHIFT' | 'COVERAGE' | 'REST' | 'COVERAGE_NEEDED' | 'NO_SCHEDULE';
  source: string;
  templateName?: string;
  partnerId?: number;
  leaveKind?: 'leave' | 'permission';
}

export type WorkforceErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'DUPLICATE_DEVICE_USER_ID'
  | 'INVALID_NAME'
  | 'INVALID_DATE'
  | 'INVALID_RANGE'
  | 'INVALID_SALARY'
  | 'INVALID_TEMPLATE'
  | 'TEMPLATE_IN_USE'
  | 'ASSIGNMENT_OVERLAP'
  | 'REST_OVERLAP'
  | 'PAIR_CONFLICT'
  | 'PAIR_SAME_EMPLOYEE'
  | 'REASON_REQUIRED'
  | 'INVALID_PHOTO'
  | 'EMPLOYEE_MUST_BE_INACTIVE'
  | 'EMPLOYEE_HAS_HISTORY'
  | 'SCHEDULE_ERROR';

export interface WorkforceError {
  code: WorkforceErrorCode;
  messageKey: string;
  details?: readonly string[];
}

const failure = (code: WorkforceErrorCode, details?: readonly string[]): WorkforceError => ({
  code,
  messageKey: `errors.${code.toLowerCase()}`,
  ...(details ? { details } : {}),
});

const validRange = (from: string, to?: string | null): boolean =>
  isValidLocalDate(from) && (!to || (isValidLocalDate(to) && from <= to));

const previousDate = (date: string): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

const employeeView = (record: EmployeeRecord, includeSalary: boolean): EmployeeView => ({
  id: record.id,
  fullName: record.fullName,
  deviceUserId: record.deviceUserId,
  hasPhoto: record.photoPath !== null,
  hireDate: record.hireDate,
  active: record.active,
  ...(includeSalary
    ? { monthlySalaryMinor: record.monthlySalaryMinor, wageBasisDays: record.wageBasisDays }
    : {}),
});

const templateCore = (record: ShiftTemplateRecord) => ({
  id: String(record.id),
  name: record.name,
  startMin: record.startMin,
  endMin: record.endMin,
  inFromMin: record.inFromMin,
  inToMin: record.inToMin,
  outFromMin: record.outFromMin,
  outToMin: record.outToMin,
});

const monthDates = (month: string): readonly string[] | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (monthIndex < 1 || monthIndex > 12) return null;
  const count = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${match[1]}-${match[2]}-${String(index + 1).padStart(2, '0')}`,
  );
};

export class WorkforceService {
  private readonly repository: WorkforceRepository;
  private readonly audit: AuditRepository;
  private readonly clock: Clock;

  constructor(
    private readonly database: DawamDatabase,
    private readonly auth: AuthService,
    private readonly photosDirectory: string,
    clock: Clock = systemClock,
  ) {
    this.repository = new WorkforceRepository(database);
    this.audit = new AuditRepository(database, clock);
    this.clock = clock;
    mkdirSync(photosDirectory, { recursive: true });
    this.ensureDefaultTemplates();
  }

  private ensureDefaultTemplates(): void {
    if (this.repository.listTemplates().length > 0) return;
    this.database.transaction(() => {
      const defaults = [
        {
          name: 'Morning',
          active: true,
          startMin: 600,
          endMin: 1320,
          inFromMin: 580,
          inToMin: 660,
          outFromMin: 1300,
          outToMin: 1380,
        },
        {
          name: 'Evening',
          active: true,
          startMin: 780,
          endMin: 1500,
          inFromMin: 760,
          inToMin: 840,
          outFromMin: 1480,
          outToMin: 1560,
        },
      ];
      for (const item of defaults) {
        const created = this.repository.insertTemplate(item);
        this.audit.append({
          actorUserId: null,
          action: 'shift_template.seeded',
          entity: 'shift_template',
          entityId: String(created.id),
          after: created,
          reason: 'system_seed',
        });
      }
    });
  }

  private requireRead(): ServiceResult<SessionUser, WorkforceError> {
    const result = this.auth.authorize('attendance.read');
    return result.ok
      ? result
      : {
          ok: false,
          error: failure(result.error.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'FORBIDDEN'),
        };
  }

  private requireManage(): ServiceResult<SessionUser, WorkforceError> {
    const result = this.auth.authorize('workforce.manage');
    return result.ok
      ? result
      : {
          ok: false,
          error: failure(result.error.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'FORBIDDEN'),
        };
  }

  listEmployees(): ServiceResult<readonly EmployeeView[], WorkforceError> {
    const actor = this.requireRead();
    if (!actor.ok) return actor;
    const includeSalary = actor.value.role === 'admin';
    return {
      ok: true,
      value: this.repository.listEmployees().map((item) => employeeView(item, includeSalary)),
    };
  }

  getEmployeePhoto(employeeId: number): ServiceResult<EmployeePhotoView | null, WorkforceError> {
    const actor = this.requireRead();
    if (!actor.ok) return actor;
    const employee = this.repository.findEmployee(employeeId);
    if (!employee) return { ok: false, error: failure('NOT_FOUND') };
    if (!employee.photoPath) return { ok: true, value: null };

    const photosRoot = `${resolve(this.photosDirectory)}${sep}`;
    const photoPath = resolve(employee.photoPath);
    if (!photoPath.startsWith(photosRoot) || !existsSync(photoPath))
      return { ok: true, value: null };
    const mimeType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    }[extname(photoPath).toLowerCase()] as EmployeePhotoView['mimeType'] | undefined;
    if (!mimeType) return { ok: true, value: null };
    return {
      ok: true,
      value: { mimeType, dataBase64: readFileSync(photoPath).toString('base64') },
    };
  }

  getEmployeeSchedule(
    employeeId: number,
    date: string,
  ): ServiceResult<EmployeeScheduleProfile, WorkforceError> {
    const actor = this.requireRead();
    if (!actor.ok) return actor;
    if (!isValidLocalDate(date)) return { ok: false, error: failure('INVALID_DATE') };
    if (!this.repository.findEmployee(employeeId))
      return { ok: false, error: failure('NOT_FOUND') };
    const assignment = this.repository.findAssignmentAt(employeeId, date);
    const rest = this.repository.findRestAt(employeeId, date);
    const pair = this.repository.findPairAt(employeeId, date);
    return {
      ok: true,
      value: {
        templateId: assignment?.templateId ?? null,
        weekday: rest?.weekday ?? null,
        partnerId: pair ? (pair.employeeA === employeeId ? pair.employeeB : pair.employeeA) : null,
      },
    };
  }

  private savePhoto(photo: EmployeeInput['photo']): ServiceResult<string | null, WorkforceError> {
    if (!photo) return { ok: true, value: null };
    const bytes = Buffer.from(photo.dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024)
      return { ok: false, error: failure('INVALID_PHOTO') };
    const validSignature =
      (photo.mimeType === 'image/jpeg' &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff) ||
      (photo.mimeType === 'image/png' &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (photo.mimeType === 'image/webp' &&
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP');
    if (!validSignature) return { ok: false, error: failure('INVALID_PHOTO') };
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[photo.mimeType];
    const path = join(this.photosDirectory, `${randomUUID()}.${ext}`);
    writeFileSync(path, bytes, { flag: 'wx' });
    return { ok: true, value: path };
  }

  createEmployee(input: EmployeeInput): ServiceResult<EmployeeView, WorkforceError> {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    const name = input.fullName.trim();
    const deviceUserId = input.deviceUserId.trim();
    if (!name || !deviceUserId) return { ok: false, error: failure('INVALID_NAME') };
    if (!input.reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    if (input.hireDate && !isValidLocalDate(input.hireDate))
      return { ok: false, error: failure('INVALID_DATE') };
    if ((input.monthlySalaryMinor ?? 0) < 0 || input.wageBasisDays < 1 || input.wageBasisDays > 366)
      return { ok: false, error: failure('INVALID_SALARY') };
    if (this.repository.findEmployeeByDeviceId(deviceUserId))
      return { ok: false, error: failure('DUPLICATE_DEVICE_USER_ID') };
    const photo = this.savePhoto(input.photo);
    if (!photo.ok) return photo;
    const created = this.database.transaction(() => {
      const record = this.repository.insertEmployee({
        fullName: name,
        deviceUserId,
        photoPath: photo.value,
        hireDate: input.hireDate ?? null,
        active: input.active,
        monthlySalaryMinor: input.monthlySalaryMinor ?? null,
        wageBasisDays: input.wageBasisDays,
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'employee.created',
        entity: 'employee',
        entityId: String(record.id),
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true, value: employeeView(created, true) };
  }

  updateEmployee(id: number, input: EmployeeInput): ServiceResult<EmployeeView, WorkforceError> {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    const before = this.repository.findEmployee(id);
    if (!before) return { ok: false, error: failure('NOT_FOUND') };
    const duplicate = this.repository.findEmployeeByDeviceId(input.deviceUserId.trim());
    if (duplicate && duplicate.id !== id)
      return { ok: false, error: failure('DUPLICATE_DEVICE_USER_ID') };
    if (!input.fullName.trim() || !input.deviceUserId.trim())
      return { ok: false, error: failure('INVALID_NAME') };
    if (!input.reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    if (input.hireDate && !isValidLocalDate(input.hireDate))
      return { ok: false, error: failure('INVALID_DATE') };
    if ((input.monthlySalaryMinor ?? 0) < 0 || input.wageBasisDays < 1 || input.wageBasisDays > 366)
      return { ok: false, error: failure('INVALID_SALARY') };
    const photo = this.savePhoto(input.photo);
    if (!photo.ok) return photo;
    const updated = this.database.transaction(() => {
      const record = this.repository.updateEmployee(id, {
        fullName: input.fullName.trim(),
        deviceUserId: input.deviceUserId.trim(),
        photoPath: photo.value ?? before.photoPath,
        hireDate: input.hireDate ?? null,
        active: input.active,
        monthlySalaryMinor: input.monthlySalaryMinor ?? null,
        wageBasisDays: input.wageBasisDays,
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'employee.updated',
        entity: 'employee',
        entityId: String(id),
        before,
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true, value: employeeView(updated, true) };
  }

  deleteEmployee(id: number, reason: string): ServiceResult<true, WorkforceError> {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    const before = this.repository.findEmployee(id);
    if (!before) return { ok: false, error: failure('NOT_FOUND') };
    if (before.active) return { ok: false, error: failure('EMPLOYEE_MUST_BE_INACTIVE') };
    if (!reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    if (this.repository.hasEmployeeHistory(id, before.deviceUserId)) {
      return { ok: false, error: failure('EMPLOYEE_HAS_HISTORY') };
    }
    this.database.transaction(() => {
      this.repository.deleteEmployee(id);
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'employee.deleted',
        entity: 'employee',
        entityId: String(id),
        before,
        after: null,
        reason,
      });
    });
    if (before.photoPath && existsSync(before.photoPath)) unlinkSync(before.photoPath);
    return { ok: true, value: true };
  }

  listTemplates(): ServiceResult<readonly ShiftTemplateRecord[], WorkforceError> {
    const actor = this.requireRead();
    return actor.ok ? { ok: true, value: this.repository.listTemplates() } : actor;
  }

  createTemplate(input: TemplateInput): ServiceResult<ShiftTemplateRecord, WorkforceError> {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    if (!input.reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    const validation = validateShiftTemplate({ id: 'new', ...input });
    if (!validation.ok)
      return {
        ok: false,
        error: failure(
          'INVALID_TEMPLATE',
          validation.error.map((item) => item.code),
        ),
      };
    const created = this.database.transaction(() => {
      const record = this.repository.insertTemplate({
        name: input.name.trim(),
        active: input.active,
        startMin: input.startMin,
        endMin: input.endMin,
        inFromMin: input.inFromMin,
        inToMin: input.inToMin,
        outFromMin: input.outFromMin,
        outToMin: input.outToMin,
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'shift_template.created',
        entity: 'shift_template',
        entityId: String(record.id),
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true, value: created };
  }

  updateTemplate(
    id: number,
    input: TemplateInput,
  ): ServiceResult<ShiftTemplateRecord, WorkforceError> {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    const before = this.repository.findTemplate(id);
    if (!before) return { ok: false, error: failure('NOT_FOUND') };
    if (this.repository.isTemplateAssigned(id)) {
      return { ok: false, error: failure('TEMPLATE_IN_USE') };
    }
    if (!input.reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    const validation = validateShiftTemplate({ id: String(id), ...input });
    if (!validation.ok) {
      return {
        ok: false,
        error: failure(
          'INVALID_TEMPLATE',
          validation.error.map((item) => item.code),
        ),
      };
    }
    const updated = this.database.transaction(() => {
      const record = this.repository.updateTemplate(id, {
        name: input.name.trim(),
        active: input.active,
        startMin: input.startMin,
        endMin: input.endMin,
        inFromMin: input.inFromMin,
        inToMin: input.inToMin,
        outFromMin: input.outFromMin,
        outToMin: input.outToMin,
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: 'shift_template.updated',
        entity: 'shift_template',
        entityId: String(id),
        before,
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true, value: updated };
  }

  updateEmployeeSchedule(input: {
    employeeId: number;
    templateId: number;
    weekday: number;
    partnerId: number | null;
    effectiveFrom: string;
    reason: string;
  }): ServiceResult<EmployeeScheduleProfile, WorkforceError> {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    if (!input.reason.trim()) return { ok: false, error: failure('REASON_REQUIRED') };
    if (!isValidLocalDate(input.effectiveFrom) || input.weekday < 1 || input.weekday > 7)
      return { ok: false, error: failure('INVALID_RANGE') };
    if (input.partnerId === input.employeeId)
      return { ok: false, error: failure('PAIR_SAME_EMPLOYEE') };
    if (
      !this.repository.findEmployee(input.employeeId) ||
      !this.repository.findTemplate(input.templateId) ||
      (input.partnerId !== null && !this.repository.findEmployee(input.partnerId))
    )
      return { ok: false, error: failure('NOT_FOUND') };

    const existingAssignment = this.repository.findAssignmentAt(
      input.employeeId,
      input.effectiveFrom,
    );
    const existingRest = this.repository.findRestAt(input.employeeId, input.effectiveFrom);
    const existingPair = this.repository.findPairAt(input.employeeId, input.effectiveFrom);
    const partnerPair =
      input.partnerId === null
        ? null
        : this.repository.findPairAt(input.partnerId, input.effectiveFrom);
    if (partnerPair && partnerPair.id !== existingPair?.id)
      return { ok: false, error: failure('PAIR_CONFLICT') };

    this.database.transaction(() => {
      if (existingAssignment?.templateId !== input.templateId) {
        if (existingAssignment && existingAssignment.validFrom !== input.effectiveFrom) {
          this.repository.updateAssignment(existingAssignment.id, {
            templateId: existingAssignment.templateId,
            validTo: previousDate(input.effectiveFrom),
          });
        }
        const record =
          existingAssignment?.validFrom === input.effectiveFrom
            ? this.repository.updateAssignment(existingAssignment.id, {
                templateId: input.templateId,
                validTo: null,
              })
            : this.repository.insertAssignment({
                employeeId: input.employeeId,
                templateId: input.templateId,
                validFrom: input.effectiveFrom,
                validTo: null,
              });
        this.audit.append({
          actorUserId: actor.value.id,
          action: existingAssignment ? 'shift_assignment.changed' : 'shift_assignment.created',
          entity: 'shift_assignment',
          entityId: String(record.id),
          before: existingAssignment ?? undefined,
          after: record,
          reason: input.reason,
        });
      }

      if (existingRest?.weekday !== input.weekday) {
        if (existingRest && existingRest.validFrom !== input.effectiveFrom) {
          this.repository.updateRest(existingRest.id, {
            weekday: existingRest.weekday,
            validTo: previousDate(input.effectiveFrom),
          });
        }
        const record =
          existingRest?.validFrom === input.effectiveFrom
            ? this.repository.updateRest(existingRest.id, {
                weekday: input.weekday,
                validTo: null,
              })
            : this.repository.insertRest({
                employeeId: input.employeeId,
                weekday: input.weekday,
                validFrom: input.effectiveFrom,
                validTo: null,
              });
        this.audit.append({
          actorUserId: actor.value.id,
          action: existingRest ? 'weekly_rest.changed' : 'weekly_rest.created',
          entity: 'weekly_rest',
          entityId: String(record.id),
          before: existingRest ?? undefined,
          after: record,
          reason: input.reason,
        });
      }

      const currentPartnerId = existingPair
        ? existingPair.employeeA === input.employeeId
          ? existingPair.employeeB
          : existingPair.employeeA
        : null;
      if (currentPartnerId !== input.partnerId) {
        if (existingPair && input.partnerId === null) {
          if (existingPair.validFrom === input.effectiveFrom)
            this.repository.deletePair(existingPair.id);
          else
            this.repository.updatePair(existingPair.id, {
              employeeA: existingPair.employeeA,
              employeeB: existingPair.employeeB,
              validTo: previousDate(input.effectiveFrom),
            });
          this.audit.append({
            actorUserId: actor.value.id,
            action: 'teammate_pair.removed',
            entity: 'teammate_pair',
            entityId: String(existingPair.id),
            before: existingPair,
            reason: input.reason,
          });
        }
        if (input.partnerId !== null) {
          if (existingPair && existingPair.validFrom !== input.effectiveFrom) {
            this.repository.updatePair(existingPair.id, {
              employeeA: existingPair.employeeA,
              employeeB: existingPair.employeeB,
              validTo: previousDate(input.effectiveFrom),
            });
          }
          const record =
            existingPair?.validFrom === input.effectiveFrom
              ? this.repository.updatePair(existingPair.id, {
                  employeeA: input.employeeId,
                  employeeB: input.partnerId,
                  validTo: null,
                })
              : this.repository.insertPair({
                  employeeA: input.employeeId,
                  employeeB: input.partnerId,
                  validFrom: input.effectiveFrom,
                  validTo: null,
                });
          this.audit.append({
            actorUserId: actor.value.id,
            action: existingPair ? 'teammate_pair.changed' : 'teammate_pair.created',
            entity: 'teammate_pair',
            entityId: String(record.id),
            before: existingPair ?? undefined,
            after: record,
            reason: input.reason,
          });
        }
      }
    });

    return this.getEmployeeSchedule(input.employeeId, input.effectiveFrom);
  }

  createAssignment(input: {
    employeeId: number;
    templateId: number;
    validFrom: string;
    validTo?: string | null;
    reason: string;
  }) {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    if (!input.reason.trim()) return { ok: false as const, error: failure('REASON_REQUIRED') };
    if (!validRange(input.validFrom, input.validTo))
      return { ok: false as const, error: failure('INVALID_RANGE') };
    if (
      !this.repository.findEmployee(input.employeeId) ||
      !this.repository.findTemplate(input.templateId)
    )
      return { ok: false as const, error: failure('NOT_FOUND') };
    const existing = this.repository.findAssignmentAt(input.employeeId, input.validFrom);
    const value = this.database.transaction(() => {
      let record;
      if (existing?.validFrom === input.validFrom) {
        record = this.repository.updateAssignment(existing.id, {
          templateId: input.templateId,
          validTo: input.validTo ?? null,
        });
      } else {
        if (existing) {
          this.repository.updateAssignment(existing.id, {
            templateId: existing.templateId,
            validTo: previousDate(input.validFrom),
          });
        }
        record = this.repository.insertAssignment({
          employeeId: input.employeeId,
          templateId: input.templateId,
          validFrom: input.validFrom,
          validTo: input.validTo ?? null,
        });
      }
      this.audit.append({
        actorUserId: actor.value.id,
        action: existing ? 'shift_assignment.changed' : 'shift_assignment.created',
        entity: 'shift_assignment',
        entityId: String(record.id),
        before: existing ?? undefined,
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true as const, value };
  }

  createRest(input: {
    employeeId: number;
    weekday: number;
    validFrom: string;
    validTo?: string | null;
    reason: string;
  }) {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    if (!input.reason.trim()) return { ok: false as const, error: failure('REASON_REQUIRED') };
    if (!validRange(input.validFrom, input.validTo) || input.weekday < 1 || input.weekday > 7)
      return { ok: false as const, error: failure('INVALID_RANGE') };
    if (!this.repository.findEmployee(input.employeeId))
      return { ok: false as const, error: failure('NOT_FOUND') };
    const existing = this.repository.findRestAt(input.employeeId, input.validFrom);
    const value = this.database.transaction(() => {
      let record;
      if (existing?.validFrom === input.validFrom) {
        record = this.repository.updateRest(existing.id, {
          weekday: input.weekday,
          validTo: input.validTo ?? null,
        });
      } else {
        if (existing) {
          this.repository.updateRest(existing.id, {
            weekday: existing.weekday,
            validTo: previousDate(input.validFrom),
          });
        }
        record = this.repository.insertRest({
          employeeId: input.employeeId,
          weekday: input.weekday,
          validFrom: input.validFrom,
          validTo: input.validTo ?? null,
        });
      }
      this.audit.append({
        actorUserId: actor.value.id,
        action: existing ? 'weekly_rest.changed' : 'weekly_rest.created',
        entity: 'weekly_rest',
        entityId: String(record.id),
        before: existing ?? undefined,
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true as const, value };
  }

  createPair(input: {
    employeeA: number;
    employeeB: number;
    validFrom: string;
    validTo?: string | null;
    reason: string;
  }) {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    if (!input.reason.trim()) return { ok: false as const, error: failure('REASON_REQUIRED') };
    if (input.employeeA === input.employeeB)
      return { ok: false as const, error: failure('PAIR_SAME_EMPLOYEE') };
    if (!validRange(input.validFrom, input.validTo))
      return { ok: false as const, error: failure('INVALID_RANGE') };
    if (
      !this.repository.findEmployee(input.employeeA) ||
      !this.repository.findEmployee(input.employeeB)
    )
      return { ok: false as const, error: failure('NOT_FOUND') };
    const existingA = this.repository.findPairAt(input.employeeA, input.validFrom);
    const existingB = this.repository.findPairAt(input.employeeB, input.validFrom);
    if (existingB && existingB.id !== existingA?.id)
      return { ok: false as const, error: failure('PAIR_CONFLICT') };
    const value = this.database.transaction(() => {
      let record;
      if (existingA?.validFrom === input.validFrom) {
        record = this.repository.updatePair(existingA.id, {
          employeeA: input.employeeA,
          employeeB: input.employeeB,
          validTo: input.validTo ?? null,
        });
      } else {
        if (existingA) {
          this.repository.updatePair(existingA.id, {
            employeeA: existingA.employeeA,
            employeeB: existingA.employeeB,
            validTo: previousDate(input.validFrom),
          });
        }
        record = this.repository.insertPair({
          employeeA: input.employeeA,
          employeeB: input.employeeB,
          validFrom: input.validFrom,
          validTo: input.validTo ?? null,
        });
      }
      this.audit.append({
        actorUserId: actor.value.id,
        action: existingA ? 'teammate_pair.changed' : 'teammate_pair.created',
        entity: 'teammate_pair',
        entityId: String(record.id),
        before: existingA ?? undefined,
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true as const, value };
  }

  setOverride(input: {
    employeeId: number;
    date: string;
    kind: ScheduleOverrideKind;
    templateId?: number | null;
    reason: string;
  }) {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    if (!input.reason.trim()) return { ok: false as const, error: failure('REASON_REQUIRED') };
    if (!isValidLocalDate(input.date))
      return { ok: false as const, error: failure('INVALID_DATE') };
    if (
      !this.repository.findEmployee(input.employeeId) ||
      (input.kind === 'shift' &&
        (!input.templateId || !this.repository.findTemplate(input.templateId)))
    )
      return { ok: false as const, error: failure('NOT_FOUND') };
    const before = this.repository.findOverride(input.employeeId, input.date);
    const value = this.database.transaction(() => {
      const record = this.repository.upsertOverride({
        employeeId: input.employeeId,
        date: input.date,
        kind: input.kind,
        templateId: input.templateId ?? null,
        reason: input.reason,
        createdBy: actor.value.id,
        createdAt: this.clock.now().toISOString(),
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: before ? 'schedule_override.updated' : 'schedule_override.created',
        entity: 'schedule_override',
        entityId: String(record.id),
        before: before ?? undefined,
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true as const, value };
  }

  createLeave(input: {
    employeeId: number;
    dateFrom: string;
    dateTo: string;
    kind: 'leave' | 'permission';
    note?: string | null;
    reason: string;
  }) {
    const actor = this.requireManage();
    if (!actor.ok) return actor;
    if (!input.reason.trim()) return { ok: false as const, error: failure('REASON_REQUIRED') };
    if (
      !validRange(input.dateFrom, input.dateTo) ||
      !this.repository.findEmployee(input.employeeId)
    )
      return { ok: false as const, error: failure('INVALID_RANGE') };
    const value = this.database.transaction(() => {
      const record = this.repository.insertLeave({
        employeeId: input.employeeId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        kind: input.kind,
        note: input.note ?? null,
        approvedBy: actor.value.id,
        createdAt: this.clock.now().toISOString(),
      });
      this.audit.append({
        actorUserId: actor.value.id,
        action: `${input.kind}.created`,
        entity: input.kind,
        entityId: String(record.id),
        after: record,
        reason: input.reason,
      });
      return record;
    });
    return { ok: true as const, value };
  }

  calendar(
    employeeId: number,
    month: string,
  ): ServiceResult<readonly CalendarDay[], WorkforceError> {
    const actor = this.requireRead();
    if (!actor.ok) return actor;
    if (!this.repository.findEmployee(employeeId))
      return { ok: false, error: failure('NOT_FOUND') };
    const dates = monthDates(month);
    if (!dates) return { ok: false, error: failure('INVALID_DATE') };
    const context: ScheduleContext = {
      templates: this.repository.listTemplates().map(templateCore),
      assignments: this.repository.listAssignments().map((item) => ({
        employeeId: String(item.employeeId),
        templateId: String(item.templateId),
        validFrom: item.validFrom,
        ...(item.validTo ? { validTo: item.validTo } : {}),
      })),
      weeklyRest: this.repository.listRests().map((item) => ({
        employeeId: String(item.employeeId),
        weekday: item.weekday,
        validFrom: item.validFrom,
        ...(item.validTo ? { validTo: item.validTo } : {}),
      })),
      overrides: this.repository.listOverrides().map((item) => ({
        employeeId: String(item.employeeId),
        date: item.date,
        kind: item.kind,
        ...(item.templateId ? { templateId: String(item.templateId) } : {}),
        reason: item.reason,
      })),
      pairs: this.repository.listPairs().map((item) => ({
        employeeA: String(item.employeeA),
        employeeB: String(item.employeeB),
        validFrom: item.validFrom,
        ...(item.validTo ? { validTo: item.validTo } : {}),
      })),
      leaves: this.repository.listLeaves().map((item) => ({
        employeeId: String(item.employeeId),
        dateFrom: item.dateFrom,
        dateTo: item.dateTo,
        kind: item.kind,
      })),
    };
    const result: CalendarDay[] = [];
    for (const date of dates) {
      const resolved = resolveSchedule(String(employeeId), date, context);
      if (!resolved.ok)
        return { ok: false, error: failure('SCHEDULE_ERROR', [resolved.error.code]) };
      result.push({
        date,
        kind: resolved.value.kind,
        source: resolved.value.source,
        ...(resolved.value.template ? { templateName: resolved.value.template.name } : {}),
        ...(resolved.value.partnerId ? { partnerId: Number(resolved.value.partnerId) } : {}),
        ...(resolved.value.leaveKind ? { leaveKind: resolved.value.leaveKind } : {}),
      });
    }
    return { ok: true, value: result };
  }
}
