import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AuditDto, SessionDto } from '../../shared/ipc';

interface SettingsScreenProps {
  session: SessionDto;
  onProfileUpdated: (session: SessionDto, photoUrl: string) => void;
}

export const SettingsScreen = ({
  session,
  onProfileUpdated,
}: SettingsScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<readonly SessionDto[]>([]);
  const [profilePhoto, setProfilePhoto] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<{
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    dataBase64: string;
  } | null>(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirm: '',
    role: 'admin' as 'admin' | 'user',
    canImport: true,
  });
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<SessionDto | null>(null);
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' });
  const [resetting, setResetting] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState('');
  const [editTarget, setEditTarget] = useState<SessionDto | null>(null);
  const [editForm, setEditForm] = useState({ role: 'admin' as 'admin' | 'user', canImport: true });
  const [savingAccount, setSavingAccount] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState<0 | 5 | 15 | 30 | 60>(15);
  const [backupFolder, setBackupFolder] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [restorePath, setRestorePath] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [auditRows, setAuditRows] = useState<readonly AuditDto[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [auditResetReason, setAuditResetReason] = useState('');
  const [auditResetConfirmation, setAuditResetConfirmation] = useState('');

  const showError = (text: string): void => setNotice({ tone: 'error', text });
  const showSuccess = (text: string): void => setNotice({ tone: 'success', text });

  const load = async (): Promise<void> => {
    if (!window.dawam) return;
    const photoResult = await window.dawam.users.getPhoto({ userId: session.id });
    if (photoResult.ok && photoResult.value) {
      setProfilePhoto(`data:${photoResult.value.mimeType};base64,${photoResult.value.dataBase64}`);
    }
    if (session.role !== 'admin') return;
    const [usersResult, idleResult, auditResult] = await Promise.all([
      window.dawam.users.list(),
      window.dawam.settings.getIdleLockMinutes(),
      window.dawam.audit.list({ limit: 100 }),
    ]);
    if (usersResult.ok) setUsers(usersResult.value);
    else showError(t(usersResult.error.messageKey));
    if (idleResult.ok) setIdleMinutes(idleResult.value as 0 | 5 | 15 | 30 | 60);
    if (auditResult.ok) setAuditRows(auditResult.value);
  };

  useEffect(() => {
    void load();
  }, []);

  const readPhoto = (file?: File): void => {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const value = {
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        dataBase64: String(reader.result).split(',')[1] ?? '',
      };
      setSelectedPhoto(value);
    };
    reader.readAsDataURL(file);
  };

  const savePhoto = async (): Promise<void> => {
    if (!window.dawam || !selectedPhoto) return;
    const result = await window.dawam.users.updateOwnPhoto(selectedPhoto);
    if (!result.ok) {
      showError(t(result.error.messageKey));
      return;
    }
    const url = `data:${selectedPhoto.mimeType};base64,${selectedPhoto.dataBase64}`;
    setProfilePhoto(url);
    setSelectedPhoto(null);
    onProfileUpdated(result.value, url);
    showSuccess(t('settings.photoSaved'));
  };

  const createAccount = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!window.dawam) return;
    if (form.password !== form.confirm) {
      showError(t('access.passwordMismatch'));
      return;
    }
    setCreating(true);
    try {
      const result = await window.dawam.users.create({
        username: form.username,
        password: form.password,
        role: form.role,
        canImport: form.canImport,
        reason: 'Account created from Settings',
      });
      if (!result.ok) {
        showError(t(result.error.messageKey));
        return;
      }
      setForm({ username: '', password: '', confirm: '', role: 'admin', canImport: true });
      showSuccess(t('settings.accountCreatedNamed', { name: result.value.username }));
      await load();
    } finally {
      setCreating(false);
    }
  };

  const wipeAppData = async (): Promise<void> => {
    if (!window.dawam || wipeConfirm !== 'RESET') return;
    const result = await window.dawam.settings.resetAppData({ confirmation: 'RESET' });
    if (!result.ok) {
      showError(t('settings.wipeFailed'));
      return;
    }
    window.location.reload();
  };

  const resetPassword = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!window.dawam || !resetTarget) return;
    if (resetForm.password !== resetForm.confirm) {
      showError(t('access.passwordMismatch'));
      return;
    }
    setResetting(true);
    try {
      const result = await window.dawam.users.resetPassword({
        userId: resetTarget.id,
        password: resetForm.password,
        reason: 'Administrator reset from Settings',
      });
      if (!result.ok) {
        showError(t(result.error.messageKey));
        return;
      }
      showSuccess(t('settings.passwordResetDone', { name: result.value.username }));
      setResetTarget(null);
      setResetForm({ password: '', confirm: '' });
    } finally {
      setResetting(false);
    }
  };

  const saveAccount = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!window.dawam || !editTarget) return;
    setSavingAccount(true);
    try {
      let updated = editTarget;
      if (updated.role !== editForm.role) {
        const roleResult = await window.dawam.users.setRole({
          userId: updated.id,
          role: editForm.role,
          reason: 'Account role changed from Settings',
        });
        if (!roleResult.ok) {
          showError(t(roleResult.error.messageKey));
          return;
        }
        updated = roleResult.value;
      }
      if (updated.canImport !== editForm.canImport) {
        const permissionResult = await window.dawam.users.setCanImport({
          userId: updated.id,
          canImport: editForm.canImport,
          reason: 'Import permission changed from Settings',
        });
        if (!permissionResult.ok) {
          showError(t(permissionResult.error.messageKey));
          return;
        }
        updated = permissionResult.value;
      }
      showSuccess(t('settings.accountUpdated', { name: updated.username }));
      setEditTarget(null);
      await load();
    } finally {
      setSavingAccount(false);
    }
  };

  const setActive = async (user: SessionDto, active: boolean): Promise<void> => {
    if (!window.dawam) return;
    if (!active && !window.confirm(t('settings.deactivateConfirm', { name: user.username })))
      return;
    const result = await window.dawam.users.setActive({
      userId: user.id,
      active,
      reason: active ? 'Account reactivated from Settings' : 'Account deactivated from Settings',
    });
    if (!result.ok) showError(t(result.error.messageKey));
    else {
      showSuccess(active ? t('settings.accountReactivated') : t('settings.accountDeactivated'));
      await load();
    }
  };

  const verifyAudit = async (): Promise<void> => {
    if (!window.dawam) return;
    const result = await window.dawam.audit.verify();
    if (result.ok && result.value.valid) showSuccess(t('settings.auditValid'));
    else showError(t('settings.auditInvalid'));
  };

  const resetAudit = async (): Promise<void> => {
    if (!window.dawam || auditResetConfirmation !== 'RESET' || !auditResetReason.trim()) return;
    if (!window.confirm(t('settings.auditResetConfirm'))) return;
    const result = await window.dawam.audit.reset({
      reason: auditResetReason,
      confirmation: 'RESET',
    });
    if (!result.ok) {
      showError(t(result.error.messageKey));
      return;
    }
    setAuditResetReason('');
    setAuditResetConfirmation('');
    showSuccess(t('settings.auditResetDone', { count: result.value.deletedCount }));
    await load();
  };

  const saveIdleLock = async (): Promise<void> => {
    if (!window.dawam) return;
    const result = await window.dawam.settings.setIdleLockMinutes(idleMinutes);
    if (result.ok) {
      showSuccess(t('settings.idleSaved'));
      await load();
    } else showError(t(result.error.messageKey));
  };

  const chooseBackupFolder = async (): Promise<void> => {
    if (!window.dawam) return;
    const result = await window.dawam.backup.chooseFolder();
    if (result.ok && result.value) setBackupFolder(result.value);
    else if (!result.ok) showError(t(result.error.messageKey));
  };

  const createBackup = async (): Promise<void> => {
    if (!window.dawam || !backupFolder || backupPassword.length < 10) return;
    setBackupBusy(true);
    try {
      const result = await window.dawam.backup.create({
        directory: backupFolder,
        password: backupPassword,
      });
      if (result.ok) {
        showSuccess(t('settings.backupCreated', { path: result.value.path }));
        setBackupPassword('');
        await load();
      } else showError(t(result.error.messageKey));
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseRestoreFile = async (): Promise<void> => {
    if (!window.dawam) return;
    const result = await window.dawam.backup.chooseFile();
    if (result.ok && result.value) setRestorePath(result.value);
    else if (!result.ok) showError(t(result.error.messageKey));
  };

  const stageRestore = async (): Promise<void> => {
    if (!window.dawam || !restorePath || restorePassword.length < 10) return;
    if (!window.confirm(t('settings.restoreConfirm'))) return;
    setBackupBusy(true);
    try {
      const result = await window.dawam.backup.stageRestore({
        path: restorePath,
        password: restorePassword,
      });
      if (result.ok) {
        showSuccess(t('settings.restoreReady', { path: result.value.safetyBackupPath }));
        setRestorePassword('');
        await load();
      } else showError(t(result.error.messageKey));
    } finally {
      setBackupBusy(false);
    }
  };

  const previewUrl = selectedPhoto
    ? `data:${selectedPhoto.mimeType};base64,${selectedPhoto.dataBase64}`
    : profilePhoto;

  return (
    <section className="module-screen settings-screen">
      <div className="module-header">
        <div>
          <span className="eyebrow">{t('settings.eyebrow')}</span>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>
      {notice && <div className={`settings-notice ${notice.tone}`}>{notice.text}</div>}

      <div className="settings-grid">
        <section className="card settings-card profile-settings">
          <div>
            <h2>{t('settings.profileTitle')}</h2>
            <p>{t('settings.profileHelp', { name: session.username })}</p>
          </div>
          <div className="settings-photo-preview">
            {previewUrl ? (
              <img src={previewUrl} alt="" />
            ) : (
              <span>{session.username.slice(0, 1)}</span>
            )}
          </div>
          <label className="photo-select-button">
            {t('settings.choosePhoto')}
            <input
              className="photo-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => readPhoto(event.target.files?.[0])}
            />
          </label>
          <button
            className="module-primary"
            type="button"
            disabled={!selectedPhoto}
            onClick={() => void savePhoto()}
          >
            {t('settings.savePhoto')}
          </button>
        </section>

        {session.role === 'admin' && (
          <form
            className="card settings-card account-form"
            onSubmit={(event) => void createAccount(event)}
          >
            <div>
              <h2>{t('settings.addAccount')}</h2>
              <p>{t('settings.addAccountHelp')}</p>
            </div>
            <div className="account-separation-note">{t('settings.accountSeparationHelp')}</div>
            <div className="account-access-note">{t('settings.sharedDataHelp')}</div>
            <label>
              <span>{t('access.username')}</span>
              <input
                required
                minLength={3}
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </label>
            <label>
              <span>{t('access.password')}</span>
              <input
                required
                minLength={10}
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
              <small>{t('access.passwordHint')}</small>
            </label>
            <label>
              <span>{t('access.confirmPassword')}</span>
              <input
                required
                type="password"
                value={form.confirm}
                onChange={(event) => setForm({ ...form, confirm: event.target.value })}
              />
            </label>
            <label>
              <span>{t('settings.role')}</span>
              <select
                value={form.role}
                onChange={(event) =>
                  setForm({ ...form, role: event.target.value as 'admin' | 'user' })
                }
              >
                <option value="admin">{t('header.admin')}</option>
                <option value="user">{t('header.user')}</option>
              </select>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.canImport}
                onChange={(event) => setForm({ ...form, canImport: event.target.checked })}
              />
              <span>{t('settings.canImport')}</span>
            </label>
            <button className="module-primary" type="submit" disabled={creating}>
              {creating ? t('common.saving') : t('settings.createAccount')}
            </button>
          </form>
        )}
      </div>

      {session.role === 'admin' && (
        <>
          <section className="card table-card settings-users">
            <div className="settings-table-heading">
              <div>
                <h2>
                  {t('settings.accounts')} ({users.length})
                </h2>
                <p>{t('settings.accountsHelp')}</p>
              </div>
              <button className="table-edit" type="button" onClick={() => void verifyAudit()}>
                {t('settings.verifyAudit')}
              </button>
            </div>
            {resetTarget && (
              <form
                className="settings-password-reset"
                onSubmit={(event) => void resetPassword(event)}
              >
                <div>
                  <strong>{t('settings.resetPasswordFor', { name: resetTarget.username })}</strong>
                  <small>{t('access.passwordHint')}</small>
                </div>
                <input
                  required
                  minLength={10}
                  type="password"
                  aria-label={t('settings.newPassword')}
                  placeholder={t('settings.newPassword')}
                  value={resetForm.password}
                  onChange={(event) => setResetForm({ ...resetForm, password: event.target.value })}
                />
                <input
                  required
                  minLength={10}
                  type="password"
                  aria-label={t('access.confirmPassword')}
                  placeholder={t('access.confirmPassword')}
                  value={resetForm.confirm}
                  onChange={(event) => setResetForm({ ...resetForm, confirm: event.target.value })}
                />
                <button className="module-primary" type="submit" disabled={resetting}>
                  {resetting ? t('common.saving') : t('settings.saveNewPassword')}
                </button>
                <button
                  className="table-edit"
                  type="button"
                  onClick={() => {
                    setResetTarget(null);
                    setResetForm({ password: '', confirm: '' });
                  }}
                >
                  {t('common.cancel')}
                </button>
              </form>
            )}
            {editTarget && (
              <form className="settings-account-edit" onSubmit={(event) => void saveAccount(event)}>
                <div>
                  <strong>{t('settings.editAccountFor', { name: editTarget.username })}</strong>
                  <small>{t('settings.editAccountHelp')}</small>
                </div>
                <label>
                  <span>{t('settings.role')}</span>
                  <select
                    value={editForm.role}
                    onChange={(event) =>
                      setEditForm({ ...editForm, role: event.target.value as 'admin' | 'user' })
                    }
                  >
                    <option value="admin">{t('header.admin')}</option>
                    <option value="user">{t('header.user')}</option>
                  </select>
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={editForm.canImport}
                    onChange={(event) =>
                      setEditForm({ ...editForm, canImport: event.target.checked })
                    }
                  />
                  <span>{t('settings.canImport')}</span>
                </label>
                <button className="module-primary" type="submit" disabled={savingAccount}>
                  {savingAccount ? t('common.saving') : t('common.save')}
                </button>
                <button className="table-edit" type="button" onClick={() => setEditTarget(null)}>
                  {t('common.cancel')}
                </button>
              </form>
            )}
            <table>
              <thead>
                <tr>
                  <th>{t('access.username')}</th>
                  <th>{t('settings.role')}</th>
                  <th>{t('settings.importAccess')}</th>
                  <th>{t('employees.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.username}</strong>
                      {user.id === session.id && (
                        <small className="current-account">{t('settings.currentAccount')}</small>
                      )}
                    </td>
                    <td>{user.role === 'admin' ? t('header.admin') : t('header.user')}</td>
                    <td>{user.canImport ? t('common.yes') : t('common.no')}</td>
                    <td>
                      <span className={`status-pill ${user.active ? 'active' : 'inactive'}`}>
                        {user.active ? t('employees.active') : t('employees.inactive')}
                      </span>
                    </td>
                    <td>
                      <button
                        className="table-edit"
                        type="button"
                        disabled={user.id === session.id}
                        onClick={() => {
                          setEditTarget(user);
                          setEditForm({ role: user.role, canImport: user.canImport });
                          setResetTarget(null);
                          setNotice(null);
                        }}
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        className="table-edit"
                        type="button"
                        onClick={() => {
                          setResetTarget(user);
                          setResetForm({ password: '', confirm: '' });
                          setEditTarget(null);
                          setNotice(null);
                        }}
                      >
                        {t('settings.resetPassword')}
                      </button>
                      <button
                        className={user.active ? 'table-archive' : 'table-restore'}
                        type="button"
                        disabled={user.id === session.id}
                        onClick={() => void setActive(user, !user.active)}
                      >
                        {user.active ? t('settings.deactivate') : t('settings.reactivate')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="settings-operations-grid">
            <section className="card settings-operation-card">
              <div>
                <h2>{t('settings.securityTitle')}</h2>
                <p>{t('settings.securityHelp')}</p>
              </div>
              <label>
                <span>{t('settings.idleLock')}</span>
                <select
                  value={idleMinutes}
                  onChange={(event) =>
                    setIdleMinutes(Number(event.target.value) as 0 | 5 | 15 | 30 | 60)
                  }
                >
                  <option value={0}>{t('settings.idleNever')}</option>
                  {[5, 15, 30, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {t('settings.idleMinutes', { count: minutes })}
                    </option>
                  ))}
                </select>
              </label>
              <button className="module-primary" type="button" onClick={() => void saveIdleLock()}>
                {t('common.save')}
              </button>
            </section>

            <section className="card settings-operation-card">
              <div>
                <h2>{t('settings.backupTitle')}</h2>
                <p>{t('settings.backupHelp')}</p>
              </div>
              <div className="path-picker">
                <input readOnly value={backupFolder} placeholder={t('settings.noFolder')} />
                <button
                  className="table-edit"
                  type="button"
                  onClick={() => void chooseBackupFolder()}
                >
                  {t('settings.chooseFolder')}
                </button>
              </div>
              <input
                type="password"
                minLength={10}
                value={backupPassword}
                placeholder={t('settings.backupPassword')}
                onChange={(event) => setBackupPassword(event.target.value)}
              />
              <button
                className="module-primary"
                type="button"
                disabled={backupBusy || !backupFolder || backupPassword.length < 10}
                onClick={() => void createBackup()}
              >
                {t('settings.createBackup')}
              </button>
            </section>

            <section className="card settings-operation-card restore-card">
              <div>
                <h2>{t('settings.restoreTitle')}</h2>
                <p>{t('settings.restoreHelp')}</p>
              </div>
              <div className="path-picker">
                <input readOnly value={restorePath} placeholder={t('settings.noBackupFile')} />
                <button
                  className="table-edit"
                  type="button"
                  onClick={() => void chooseRestoreFile()}
                >
                  {t('settings.chooseBackup')}
                </button>
              </div>
              <input
                type="password"
                minLength={10}
                value={restorePassword}
                placeholder={t('settings.backupPassword')}
                onChange={(event) => setRestorePassword(event.target.value)}
              />
              <button
                className="danger-button"
                type="button"
                disabled={backupBusy || !restorePath || restorePassword.length < 10}
                onClick={() => void stageRestore()}
              >
                {t('settings.prepareRestore')}
              </button>
            </section>
            <section className="card settings-operation-card restore-card">
              <div>
                <h2>{t('settings.wipeTitle')}</h2>
                <p>{t('settings.wipeHelp')}</p>
              </div>
              <input
                value={wipeConfirm}
                placeholder={t('settings.wipePlaceholder')}
                onChange={(event) => setWipeConfirm(event.target.value)}
              />
              <button
                className="danger-button"
                type="button"
                disabled={wipeConfirm !== 'RESET'}
                onClick={() => void wipeAppData()}
              >
                {t('settings.wipeButton')}
              </button>
            </section>
          </div>

          <details className="card table-card settings-audit">
            <summary>{t('settings.auditShow')}</summary>
            <div className="settings-table-heading">
              <div>
                <h2>{t('settings.auditTitle')}</h2>
                <p>{t('settings.auditHelp')}</p>
              </div>
              <input
                value={auditFilter}
                placeholder={t('settings.auditSearch')}
                onChange={(event) => setAuditFilter(event.target.value)}
              />
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t('settings.auditTime')}</th>
                  <th>{t('settings.auditAction')}</th>
                  <th>{t('settings.auditEntity')}</th>
                  <th>{t('settings.auditActor')}</th>
                  <th>{t('settings.auditReason')}</th>
                </tr>
              </thead>
              <tbody>
                {auditRows
                  .filter((row) =>
                    `${row.action} ${row.entity} ${row.entityId ?? ''} ${row.reason ?? ''}`
                      .toLowerCase()
                      .includes(auditFilter.toLowerCase()),
                  )
                  .map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.ts).toLocaleString()}</td>
                      <td>
                        <code>{row.action}</code>
                      </td>
                      <td>
                        {row.entity}
                        {row.entityId ? ` #${row.entityId}` : ''}
                      </td>
                      <td>{row.actorUserId ?? '—'}</td>
                      <td>{row.reason ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="audit-danger-zone">
              <div>
                <strong>{t('settings.auditResetTitle')}</strong>
                <p>{t('settings.auditResetHelp')}</p>
              </div>
              <input
                value={auditResetReason}
                placeholder={t('settings.auditResetReason')}
                onChange={(event) => setAuditResetReason(event.target.value)}
              />
              <input
                value={auditResetConfirmation}
                placeholder={t('settings.auditResetType')}
                onChange={(event) => setAuditResetConfirmation(event.target.value)}
              />
              <button
                className="danger-button"
                type="button"
                disabled={!auditResetReason.trim() || auditResetConfirmation !== 'RESET'}
                onClick={() => void resetAudit()}
              >
                {t('settings.auditResetAction')}
              </button>
            </div>
          </details>
        </>
      )}
    </section>
  );
};
