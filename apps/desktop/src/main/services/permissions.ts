import type { UserRole } from '@dawam/db';

export type Permission =
  | 'attendance.read'
  | 'workforce.manage'
  | 'import.run'
  | 'payroll.read'
  | 'users.manage'
  | 'backup.manage'
  | 'settings.manage'
  | 'audit.read';

export interface PermissionSubject {
  role: UserRole;
  canImport: boolean;
}

export const hasPermission = (subject: PermissionSubject, permission: Permission): boolean => {
  if (subject.role === 'admin') return true;
  if (permission === 'attendance.read') return true;
  return permission === 'import.run' && subject.canImport;
};
