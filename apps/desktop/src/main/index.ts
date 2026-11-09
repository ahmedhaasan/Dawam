import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import { AuditRepository, DawamDatabase } from '@dawam/db';

import { registerIpcHandlers } from './ipc.js';
import { AuthService } from './services/auth-service.js';
import { AttendanceService } from './services/attendance-service.js';
import { applyPendingRestore, BackupService } from './services/backup-service.js';
import { ImportService } from './services/import-service.js';
import { PayrollService } from './services/payroll-service.js';
import { SettingsService } from './services/settings-service.js';
import { WorkforceService } from './services/workforce-service.js';

let database: DawamDatabase | null = null;

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
};

app.setName('Dawam');

void app
  .whenReady()
  .then(() => {
    const dataDirectory = app.getPath('userData');
    mkdirSync(dataDirectory, { recursive: true });
    applyPendingRestore(dataDirectory);
    database = new DawamDatabase(join(dataDirectory, 'dawam.sqlite'));
    const auth = new AuthService(database, {
      profilePhotosDirectory: join(dataDirectory, 'user-photos'),
    });
    const settings = new SettingsService(database, auth);
    const audit = new AuditRepository(database);
    const workforce = new WorkforceService(database, auth, join(dataDirectory, 'photos'));
    const imports = new ImportService(database, auth);
    const attendance = new AttendanceService(database, auth);
    const payroll = new PayrollService(database, auth, attendance);
    const backupService = new BackupService(database, auth, dataDirectory, app.getVersion());
    registerIpcHandlers(ipcMain, {
      auth,
      settings,
      audit,
      workforce,
      imports,
      attendance,
      payroll,
      backup: backupService,
      dialogs: {
        chooseBackupFolder: async () => {
          const result = await dialog.showOpenDialog({
            title: 'Choose Dawam backup folder',
            properties: ['openDirectory', 'createDirectory'],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        chooseBackupFile: async () => {
          const result = await dialog.showOpenDialog({
            title: 'Choose Dawam backup',
            properties: ['openFile'],
            filters: [{ name: 'Dawam backup', extensions: ['dawam-backup'] }],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
      },
    });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    if (process.env.ELECTRON_RENDERER_URL) console.error('Dawam failed to start:', error);
    else console.error('Dawam failed to start.');
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  database?.close();
  database = null;
});
