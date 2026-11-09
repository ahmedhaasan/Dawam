import type { DawamDatabase } from './database.js';

export class SettingsRepository {
  constructor(private readonly database: DawamDatabase) {}

  get(key: string): string | null {
    const row = this.database.connection
      .prepare('SELECT value FROM settings WHERE key=?')
      .get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.database.connection
      .prepare(
        `INSERT INTO settings(key,value) VALUES(?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      )
      .run(key, value);
  }
}
