import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DawamDatabase, SettingsRepository } from '../src/index.js';

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
    expect(database.schemaVersion()).toBe(5);
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
    expect(second.schemaVersion()).toBe(5);
    expect(new SettingsRepository(second).get('language')).toBe('ar');
    second.close();
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
