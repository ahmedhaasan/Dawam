import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { DawamDatabase, SettingsRepository } from '../src/index.js';
import { migrations } from '../src/migrations.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

const temporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'dawam-db-'));
  temporaryDirectories.push(directory);
  return join(directory, 'dawam.sqlite');
};

describe('database bootstrap and persistence', () => {
  it('applies forward migrations and required safety PRAGMAs', () => {
    const path = temporaryDatabasePath();
    const database = new DawamDatabase(path);
    expect(database.schemaVersion()).toBe(7);
    expect(database.connection.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(database.connection.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'wal',
    });
    expect(database.connection.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
    database.close();
  });

  it('persists settings across a close and reopen', () => {
    const path = temporaryDatabasePath();
    const first = new DawamDatabase(path);
    new SettingsRepository(first).set('language', 'ar');
    first.close();

    const second = new DawamDatabase(path);
    expect(second.schemaVersion()).toBe(7);
    expect(new SettingsRepository(second).get('language')).toBe('ar');
    second.close();
  });

  it('installs the attendance-v2 template columns with data-safe defaults', () => {
    const database = new DawamDatabase();
    const columns = database.connection.prepare('PRAGMA table_info(shift_templates)').all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    expect(columns.find((column) => column.name === 'out_to_min')?.notnull).toBe(0);
    expect(columns.find((column) => column.name === 'late_grace_min')?.dflt_value).toBe('0');
    expect(
      columns.find((column) => column.name === 'checkout_open_before_end_min')?.dflt_value,
    ).toBe('10');
    expect(columns.find((column) => column.name === 'ot_cap_min')?.dflt_value).toBe('480');
    expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });

  it('preserves templates and assignments while upgrading a version-6 database', () => {
    const path = temporaryDatabasePath();
    const legacy = new DatabaseSync(path);
    legacy.exec('PRAGMA foreign_keys=ON');
    for (const migration of migrations.filter((item) => item.version <= 6)) {
      legacy.exec('BEGIN IMMEDIATE');
      legacy.exec(migration.sql);
      legacy.exec('COMMIT');
    }
    legacy
      .prepare(
        `INSERT INTO employees(id,full_name,device_user_id,active,wage_basis_days)
         VALUES(1,'Synthetic Employee','SYN-1',1,30)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO shift_templates(id,name,active,start_min,end_min,in_from_min,in_to_min,out_from_min,out_to_min)
         VALUES(9,'Legacy Evening',1,780,1500,760,840,1480,1560)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO shift_assignments(employee_id,template_id,valid_from)
         VALUES(1,9,'2026-11-01')`,
      )
      .run();
    legacy.close();

    const upgraded = new DawamDatabase(path);
    expect(upgraded.schemaVersion()).toBe(7);
    expect(
      upgraded.connection.prepare('SELECT * FROM shift_templates WHERE id=9').get(),
    ).toMatchObject({
      name: 'Legacy Evening',
      out_to_min: 1560,
      late_grace_min: 0,
      checkout_open_before_end_min: 10,
      ot_cap_min: 480,
    });
    expect(upgraded.connection.prepare('SELECT template_id FROM shift_assignments').get()).toEqual({
      template_id: 9,
    });
    expect(upgraded.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    upgraded.close();
  });

  it('rolls back every write in a failed transaction', () => {
    const database = new DawamDatabase();
    const settings = new SettingsRepository(database);
    expect(() =>
      database.transaction(() => {
        settings.set('language', 'en');
        throw new Error('synthetic failure');
      }),
    ).toThrow('synthetic failure');
    expect(settings.get('language')).toBeNull();
    database.close();
  });
});
