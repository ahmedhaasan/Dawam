import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type DawamDesktopApi, type IpcResult } from '../shared/ipc.js';

const invoke = <T>(channel: string, payload?: unknown): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>;

const api: DawamDesktopApi = {
  app: {
    bootstrapState: () => invoke(IPC_CHANNELS.bootstrapState),
  },
  auth: {
    createFirstAdmin: (input) => invoke(IPC_CHANNELS.createFirstAdmin, input),
    login: (input) => invoke(IPC_CHANNELS.login, input),
    logout: () => invoke(IPC_CHANNELS.logout),
    currentSession: () => invoke(IPC_CHANNELS.currentSession),
  },
  users: {
    create: (input) => invoke(IPC_CHANNELS.createUser, input),
    list: () => invoke(IPC_CHANNELS.listUsers),
    setRole: (input) => invoke(IPC_CHANNELS.setUserRole, input),
    setCanImport: (input) => invoke(IPC_CHANNELS.setUserCanImport, input),
    setActive: (input) => invoke(IPC_CHANNELS.setUserActive, input),
    resetPassword: (input) => invoke(IPC_CHANNELS.resetUserPassword, input),
    getPhoto: (input) => invoke(IPC_CHANNELS.getUserPhoto, input),
    updateOwnPhoto: (input) => invoke(IPC_CHANNELS.updateOwnPhoto, input),
  },
  settings: {
    getLanguage: () => invoke(IPC_CHANNELS.getLanguage),
    setLanguage: (language) => invoke(IPC_CHANNELS.setLanguage, { language }),
    getIdleLockMinutes: () => invoke(IPC_CHANNELS.getIdleLockMinutes),
    setIdleLockMinutes: (minutes) => invoke(IPC_CHANNELS.setIdleLockMinutes, { minutes }),
    resetAppData: (input) => invoke(IPC_CHANNELS.resetAppData, input),
  },
  audit: {
    verify: () => invoke(IPC_CHANNELS.verifyAudit),
    list: (input) => invoke(IPC_CHANNELS.listAudit, input),
    reset: (input) => invoke(IPC_CHANNELS.resetAudit, input),
  },
  backup: {
    chooseFolder: () => invoke(IPC_CHANNELS.chooseBackupFolder),
    chooseFile: () => invoke(IPC_CHANNELS.chooseBackupFile),
    create: (input) => invoke(IPC_CHANNELS.createBackup, input),
    stageRestore: (input) => invoke(IPC_CHANNELS.stageRestore, input),
  },
  imports: {
    preview: (input) => invoke(IPC_CHANNELS.previewAttendanceImport, input),
    commit: (input) => invoke(IPC_CHANNELS.commitAttendanceImport, input),
    listQuarantined: () => invoke(IPC_CHANNELS.listQuarantinedPunches),
    resolveQuarantined: (input) => invoke(IPC_CHANNELS.resolveQuarantinedPunch, input),
    ignoreDeviceId: (input) => invoke(IPC_CHANNELS.ignoreQuarantinedDeviceId, input),
  },
  attendance: {
    month: (input) => invoke(IPC_CHANNELS.getAttendanceMonth, input),
    correct: (input) => invoke(IPC_CHANNELS.setPunchCorrection, input),
  },
  payroll: {
    listPolicies: () => invoke(IPC_CHANNELS.listPayrollPolicies),
    createPolicy: (input) => invoke(IPC_CHANNELS.createPayrollPolicy, input),
    preview: (input) => invoke(IPC_CHANNELS.previewPayroll, input),
    approve: (input) => invoke(IPC_CHANNELS.approvePayroll, input),
    listRuns: (input) => invoke(IPC_CHANNELS.listPayrollRuns, input),
    voidRun: (input) => invoke(IPC_CHANNELS.voidPayrollRun, input),
  },
  workforce: {
    listEmployees: () => invoke(IPC_CHANNELS.listEmployees),
    getEmployeePhoto: (input) => invoke(IPC_CHANNELS.getEmployeePhoto, input),
    getEmployeeSchedule: (input) => invoke(IPC_CHANNELS.getEmployeeSchedule, input),
    updateEmployeeSchedule: (input) => invoke(IPC_CHANNELS.updateEmployeeSchedule, input),
    createEmployee: (input) => invoke(IPC_CHANNELS.createEmployee, input),
    updateEmployee: (input) => invoke(IPC_CHANNELS.updateEmployee, input),
    deleteEmployee: (input) => invoke(IPC_CHANNELS.deleteEmployee, input),
    employeePurgePreview: (input) => invoke(IPC_CHANNELS.employeePurgePreview, input),
    listTemplates: () => invoke(IPC_CHANNELS.listShiftTemplates),
    createTemplate: (input) => invoke(IPC_CHANNELS.createShiftTemplate, input),
    updateTemplate: (input) => invoke(IPC_CHANNELS.updateShiftTemplate, input),
    createAssignment: (input) => invoke(IPC_CHANNELS.createShiftAssignment, input),
    createRest: (input) => invoke(IPC_CHANNELS.createWeeklyRest, input),
    createPair: (input) => invoke(IPC_CHANNELS.createTeammatePair, input),
    setOverride: (input) => invoke(IPC_CHANNELS.setScheduleOverride, input),
    createLeave: (input) => invoke(IPC_CHANNELS.createLeave, input),
    calendar: (input) => invoke(IPC_CHANNELS.getScheduleCalendar, input),
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('dawam', Object.freeze(api));
