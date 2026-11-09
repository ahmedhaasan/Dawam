import { DatabaseSync } from 'node:sqlite';

import { migrations } from './migrations.js';

export type DatabasePath = string | Buffer | URL;

const hasSchemaVersion = (database: DatabaseSync): boolean => {
  const row = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get() as { found?: number } | undefined;
  return row?.found === 1;
};

const currentVersion = (database: DatabaseSync): number => {
  if (!hasSchemaVersion(database)) return 0;
  const row = database.prepare('SELECT MAX(version) AS version FROM schema_version').get() as
    { version: number | null } | undefined;
  return row?.version ?? 0;
};

const applyMigrations = (database: DatabaseSync): void => {
  let version = currentVersion(database);
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database.exec('COMMIT');
      version = migration.version;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
};

export class DawamDatabase {
  readonly connection: DatabaseSync;

  constructor(path: DatabasePath = ':memory:') {
    this.connection = new DatabaseSync(path, { timeout: 5000 });
    this.connection.exec('PRAGMA foreign_keys=ON');
    this.connection.exec('PRAGMA synchronous=FULL');
    if (path !== ':memory:') this.connection.exec('PRAGMA journal_mode=WAL');
    applyMigrations(this.connection);
  }

  transaction<T>(operation: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const value = operation();
      this.connection.exec('COMMIT');
      return value;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  schemaVersion(): number {
    return currentVersion(this.connection);
  }

  close(): void {
    this.connection.close();
  }
}
