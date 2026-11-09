import initialSql from '../migrations/0001_initial.sql?raw';
import workforceIndexesSql from '../migrations/0002_workforce_indexes.sql?raw';
import importIdempotencySql from '../migrations/0003_import_idempotency.sql?raw';
import payrollIntegritySql from '../migrations/0004_payroll_integrity.sql?raw';
import userProfilesSql from '../migrations/0005_user_profiles.sql?raw';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  { version: 1, name: '0001_initial', sql: initialSql },
  { version: 2, name: '0002_workforce_indexes', sql: workforceIndexesSql },
  { version: 3, name: '0003_import_idempotency', sql: importIdempotencySql },
  { version: 4, name: '0004_payroll_integrity', sql: payrollIntegritySql },
  { version: 5, name: '0005_user_profiles', sql: userProfilesSql },
];
