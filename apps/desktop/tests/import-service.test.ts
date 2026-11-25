import { AuditRepository, DawamDatabase, ImportRepository } from '@dawam/db';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthService } from '../src/main/services/auth-service.js';
import { ImportService } from '../src/main/services/import-service.js';
import { WorkforceService } from '../src/main/services/workforce-service.js';

const databases: DawamDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

const encoded = (value: string): string => Buffer.from(value).toString('base64');

const setup = async () => {
  const database = new DawamDatabase();
  databases.push(database);
  const auth = new AuthService(database, {
    clock: { now: () => new Date('2026-11-09T10:00:00.000Z') },
  });
  await auth.createFirstAdmin({
    username: 'owner',
    password: 'SecurePass1',
    language: 'en',
  });
  const workforce = new WorkforceService(database, auth, '/tmp/dawam-import-test-photos', {
    now: () => new Date('2026-11-09T10:00:00.000Z'),
  });
  await workforce.createEmployee({
    fullName: 'Synthetic Employee',
    deviceUserId: '001',
    active: true,
    wageBasisDays: 30,
    reason: 'Synthetic importer fixture',
  });
  return { database, auth, imports: new ImportService(database, auth) };
};

describe('attendance import service', () => {
  it('previews and commits known, quarantined, malformed, and duplicate punches atomically', async () => {
    const { database, imports } = await setup();
    const file = {
      filename: '1_attlog.dat',
      dataBase64: encoded(
        '001\t2026-11-01 09:55:00\t1\t0\t15\t0\n' +
          '001\t2026-11-01 22:05:00\t1\t1\t15\t0\n' +
          '999\t2026-11-01 10:00:00\t1\t0\t15\t0\n' +
          'bad\tdate\t1\t0\t15\t0\n',
      ),
    };
    expect(imports.preview(file)).toMatchObject({
      ok: true,
      value: {
        verification: 'VERIFIED_REAL_FIXTURE',
        rowsTotal: 4,
        predictedNew: 2,
        predictedDuplicate: 0,
        predictedQuarantined: 1,
        rowsMalformed: 1,
      },
    });
    const input = {
      ...file,
      coverageFrom: '2026-11-01 00:00:00',
      coverageTo: '2026-11-02 23:59:59',
      coverageConfirmed: true as const,
    };
    expect(imports.commit(input)).toMatchObject({
      ok: true,
      value: {
        rowsTotal: 4,
        rowsNew: 2,
        rowsDuplicate: 0,
        rowsQuarantined: 1,
        rowsMalformed: 1,
      },
    });
    const repository = new ImportRepository(database);
    expect(repository.countRawPunches()).toBe(2);
    expect(repository.countQuarantined()).toBe(1);
    expect(
      imports.commit({
        filename: 'overlap_attlog.dat',
        dataBase64: encoded(
          '001\t2026-11-01 22:05:00\t1\t1\t15\t0\n' + '001\t2026-11-02 09:58:00\t1\t0\t15\t0\n',
        ),
        coverageFrom: '2026-11-01 00:00:00',
        coverageTo: '2026-11-02 23:59:59',
        coverageConfirmed: true,
      }),
    ).toMatchObject({ ok: true, value: { rowsNew: 1, rowsDuplicate: 1 } });
    expect(imports.commit(input)).toMatchObject({
      ok: true,
      value: { rowsNew: 1, rowsDuplicate: 2, rowsQuarantined: 0 },
    });
    expect(repository.countRawPunches()).toBe(3);
    expect(repository.countQuarantined()).toBe(1);
    expect(new AuditRepository(database).verify()).toEqual({ valid: true });
    const quarantined = imports.listQuarantined();
    expect(quarantined).toMatchObject({ ok: true, value: [{ deviceUserId: '999' }] });
    if (!quarantined.ok) return;
    const employee = database.connection
      .prepare("SELECT id FROM employees WHERE device_user_id='001'")
      .get() as { id: number };
    expect(
      imports.resolveQuarantined({
        quarantineId: quarantined.value[0]!.id,
        employeeId: employee.id,
        reason: 'Confirmed synthetic device mapping',
      }),
    ).toEqual({ ok: true, value: true });
    expect(imports.listQuarantined()).toEqual({ ok: true, value: [] });
    expect(imports.commit(input)).toMatchObject({
      ok: true,
      value: { rowsNew: 1, rowsDuplicate: 2, rowsQuarantined: 0 },
    });
    expect(repository.countRawPunches()).toBe(4);
  });

  it('rejects invalid coverage and unsupported binary data without creating a batch', async () => {
    const { database, imports } = await setup();
    const validFile = {
      filename: '../attendance.dat',
      dataBase64: encoded('001\t2026-11-01 09:55:00\t1\t0\t15\t0\n'),
      coverageFrom: '2026-11-03 00:00:00',
      coverageTo: '2026-11-01 00:00:00',
      coverageConfirmed: true as const,
    };
    expect(imports.commit(validFile)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_COVERAGE' },
    });
    expect(
      imports.preview({
        filename: 'encrypted.dat',
        dataBase64: Buffer.from([1, 0, 2]).toString('base64'),
      }),
    ).toMatchObject({ ok: false, error: { code: 'ENCRYPTED_OR_BINARY' } });
    expect(new ImportRepository(database).listBatches()).toHaveLength(0);
  });

  it('lets an administrator ignore a non-employee device ID in future imports', async () => {
    const { imports } = await setup();
    const file = {
      filename: 'device_admin.dat',
      dataBase64: encoded('7\t2026-11-01 10:00:00\t1\t0\t15\t0\n'),
      coverageFrom: '2026-11-01 00:00:00',
      coverageTo: '2026-11-01 23:59:59',
      coverageConfirmed: true as const,
    };
    expect(imports.commit(file)).toMatchObject({
      ok: true,
      value: { rowsQuarantined: 1, rowsIgnored: 0 },
    });
    const quarantined = imports.listQuarantined();
    if (!quarantined.ok) throw new Error(quarantined.error.code);
    expect(
      imports.ignoreDeviceId({
        quarantineId: quarantined.value[0]!.id,
        reason: 'Device administrator is not an employee',
      }),
    ).toEqual({ ok: true, value: true });
    expect(imports.listQuarantined()).toEqual({ ok: true, value: [] });
    expect(imports.preview(file)).toMatchObject({
      ok: true,
      value: { predictedIgnored: 1, predictedQuarantined: 0 },
    });
    expect(imports.commit({ ...file, filename: 'device_admin_again.dat' })).toMatchObject({
      ok: true,
      value: { rowsIgnored: 0, rowsDuplicate: 1 },
    });
  });

  it('enforces the import permission for normal users', async () => {
    const { auth, imports } = await setup();
    await auth.createUser({
      username: 'operator',
      password: 'OperatorPass1',
      role: 'user',
      canImport: false,
      reason: 'Permission test',
    });
    auth.logout();
    await auth.login('operator', 'OperatorPass1');
    expect(
      imports.preview({
        filename: 'attendance.dat',
        dataBase64: encoded('001\t2026-11-01 09:55:00\t1\t0\t15\t0\n'),
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('rolls back the full batch if a database write fails midway', async () => {
    const { database, imports } = await setup();
    database.connection
      .prepare(
        `INSERT INTO employees(full_name,device_user_id,active,wage_basis_days)
         VALUES('Failure Fixture','FAIL',1,30)`,
      )
      .run();
    database.connection.exec(
      `CREATE TRIGGER synthetic_import_failure BEFORE INSERT ON raw_punches
       WHEN NEW.device_user_id='FAIL' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`,
    );
    expect(() =>
      imports.commit({
        filename: 'rollback.dat',
        dataBase64: encoded(
          '001\t2026-11-03 09:55:00\t1\t0\t15\t0\n' + 'FAIL\t2026-11-03 10:00:00\t1\t0\t15\t0\n',
        ),
        coverageFrom: '2026-11-03 00:00:00',
        coverageTo: '2026-11-03 23:59:59',
        coverageConfirmed: true,
      }),
    ).toThrow('synthetic failure');
    expect(new ImportRepository(database).listBatches()).toHaveLength(0);
    expect(new ImportRepository(database).countRawPunches()).toBe(0);
  });

  it('reports the validation summary in preview without writing, then in the commit result', async () => {
    const { database, imports } = await setup();
    const repository = new ImportRepository(database);
    expect(
      imports.commit({
        filename: 'first.dat',
        dataBase64: encoded(
          '001\t2026-11-01 09:55:00\t1\t0\t15\t0\n' + '001\t2026-11-01 22:05:00\t1\t1\t15\t0\n',
        ),
        coverageFrom: '2026-11-01 00:00:00',
        coverageTo: '2026-11-01 23:59:59',
        coverageConfirmed: true,
      }),
    ).toMatchObject({ ok: true, value: { rowsNew: 2, rowsReplaced: 0 } });
    const newer = {
      filename: 'newer.dat',
      dataBase64: encoded(
        '      001\t2026-11-01 09:55:00\t1\t0\t15\t0\r\n' +
          '      001\t2026-11-01 09:55:00\t1\t0\t15\t0\r\n' +
          '      001\t2026-11-01 09:58:00\t1\t0\t15\t0\r\n' +
          '      001\t2026-11-02 21:00:00\t1\t1\t15\t0\r\n' +
          '\t  42\t2026-11-02 10:00:00\t1\t0\t15\t0\r\n' +
          '      001\t2026-13-02 10:00:00\t1\t0\t15\t0\r\n',
      ),
    };
    const report = {
      rowsValid: 5,
      rowsMalformed: 1,
      malformed: [expect.objectContaining({ lineNo: 6, reason: 'INVALID_TIMESTAMP' })],
      exactDuplicates: 1,
      repeatedScans: 1,
      minLocal: '2026-11-01 09:55:00',
      maxLocal: '2026-11-02 21:00:00',
      daysCovered: 2,
      daysWithPunches: 2,
      unknownDeviceIds: [{ deviceUserId: '42', punchCount: 1 }],
      punchesToReplace: 1,
      byDeviceId: [
        {
          deviceUserId: '001',
          status: 'KNOWN',
          employeeId: expect.any(Number),
          employeeName: 'Synthetic Employee',
          punchCount: 4,
          daysWithPunches: 2,
          firstLocal: '2026-11-01 09:55:00',
          lastLocal: '2026-11-02 21:00:00',
          exactDuplicates: 1,
          repeatedScans: 1,
          punchesToReplace: 1,
        },
        expect.objectContaining({ deviceUserId: '42', status: 'UNKNOWN', punchesToReplace: 0 }),
      ],
    };
    expect(imports.preview(newer)).toMatchObject({ ok: true, value: { report } });
    expect(repository.countRawPunches()).toBe(2);
    expect(
      imports.commit({
        ...newer,
        coverageFrom: '2026-11-01 00:00:00',
        coverageTo: '2026-11-02 23:59:59',
        coverageConfirmed: true,
      }),
    ).toMatchObject({ ok: true, value: { rowsReplaced: 1, report } });
    expect(repository.countRawPunches()).toBe(3);
    expect(new AuditRepository(database).verify()).toEqual({ valid: true });
  });
});
