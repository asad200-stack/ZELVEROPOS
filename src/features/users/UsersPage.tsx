import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormGrid, TextInput } from '@/components/ui/Form';
import { Alert, Badge, EmptyState, PageHeader, TableWrap } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { DEFAULT_SUBUSER_PERMISSIONS, PERMISSION_GROUPS, normalizePermissions, type PermissionKey, type PermissionMap } from '@/constants/permissions';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import { watchSubUsers } from '@/services/userService';
import type { UserProfile } from '@/types/models';
import { formatDate } from '@/utils/format';
import { subUserSchema } from '@/validation/schemas';

export default function UsersPage() {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const { confirm, notify } = useFeedback();
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<UserProfile | 'new' | null>(null);
  const remove = useAsyncAction('users-delete');

  useEffect(
    () =>
      watchSubUsers(
        tenantId,
        (list) => {
          setError(null);
          setUsers(list.sort((a, b) => a.fullName.localeCompare(b.fullName)));
        },
        setError,
      ),
    [tenantId, retry],
  );

  const onDelete = async (u: UserProfile) => {
    const ok = await confirm({ title: t('users.delete'), message: t('users.deleteConfirm', { name: u.fullName }), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    await remove.run(async () => {
      await api.deleteSubUser({ uid: u.uid });
      notify('success', t('common.deleted'));
    });
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.users')}
        subtitle={t('users.subtitle')}
        actions={
          <Button icon="plus" onClick={() => setEditing('new')}>
            {t('users.add')}
          </Button>
        }
      />
      {error ? (
        <Alert tone="error" onRetry={() => setRetry((n) => n + 1)} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : users === null ? (
        <PageLoader />
      ) : users.length === 0 ? (
        <EmptyState icon="users" title={t('users.empty')} message={t('users.emptyHint')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('auth.fullName')}</th>
                <th>{t('auth.email')}</th>
                <th>{t('common.status')}</th>
                <th className="hide-sm">{t('users.permissions')}</th>
                <th className="hide-sm">{t('common.createdAt')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid}>
                  <td>{u.fullName}</td>
                  <td dir="ltr">{u.email}</td>
                  <td>
                    <Badge tone={u.isActive ? 'success' : 'danger'}>{u.isActive ? t('common.active') : t('common.inactive')}</Badge>
                  </td>
                  <td className="hide-sm">{t('users.permCount', { count: Object.values(u.permissions).filter(Boolean).length })}</td>
                  <td className="hide-sm">{u.createdAt ? formatDate(u.createdAt, lang) : '—'}</td>
                  <td className="actions-cell">
                    <Button size="sm" variant="ghost" icon="edit" aria-label={t('common.edit')} onClick={() => setEditing(u)} />
                    <Button size="sm" variant="ghost" icon="trash" aria-label={t('common.delete')} disabled={remove.busy} onClick={() => void onDelete(u)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {editing === 'new' && <CreateUserModal onClose={() => setEditing(null)} />}
      {editing && editing !== 'new' && <EditUserModal user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PermissionsEditor({ value, onChange, disabled }: { value: PermissionMap; onChange: (v: PermissionMap) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const toggle = (key: PermissionKey, on: boolean) => onChange(normalizePermissions({ ...value, [key]: on }));
  return (
    <div className="stack">
      {PERMISSION_GROUPS.map((g) => (
        <fieldset key={g.key} className="perm-group" disabled={disabled}>
          <legend className="section-title">{t(`users.group.${g.key}`)}</legend>
          <div className="checkbox-grid">
            {g.permissions.map((p) => (
              <Checkbox
                key={p}
                label={
                  p === 'canUseZelveroAI' ? (
                    <>
                      {t('perm.canUseZelveroAI')}
                      <span className="muted small"> — {t('users.permDesc.canUseZelveroAI')}</span>
                    </>
                  ) : (
                    t(`perm.${p}`)
                  )
                }
                title={p === 'canUseZelveroAI' ? t('users.permDesc.canUseZelveroAI') : undefined}
                checked={value[p]}
                disabled={(p !== 'canViewProducts' && g.key === 'products' && !value.canViewProducts) || (p === 'canEditSettings' && !value.canViewSettings)}
                onChange={(e) => toggle(p, e.target.checked)}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const form = useForm({ fullName: '', email: '', password: '' });
  const [perms, setPerms] = useState<PermissionMap>(DEFAULT_SUBUSER_PERMISSIONS);
  const [showPassword, setShowPassword] = useState(false);
  const { busy, run } = useAsyncAction('users-create');

  const submit = () => {
    const data = form.validate(subUserSchema);
    if (!data) return;
    void run(async () => {
      await api.createSubUser({ ...data, permissions: normalizePermissions(perms) });
      notify('success', t('users.created'));
      onClose();
    });
  };

  return (
    <Modal
      open
      size="lg"
      title={t('users.add')}
      onClose={onClose}
      busy={busy}
      footer={
        <Button loading={busy} onClick={submit}>
          {t('common.create')}
        </Button>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormGrid cols={3}>
          <TextInput label={t('auth.fullName')} required {...form.bind('fullName')} autoFocus />
          <TextInput label={t('auth.email')} required type="email" dir="ltr" autoComplete="off" {...form.bind('email')} />
          <TextInput label={t('auth.password')} required type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...form.bind('password')} />
        </FormGrid>
        <Checkbox label={t('settings.showToken')} checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
        <PermissionsEditor value={perms} onChange={setPerms} disabled={busy} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function EditUserModal({ user, onClose }: { user: UserProfile; onClose: () => void }) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const [fullName, setFullName] = useState(user.fullName);
  const [isActive, setIsActive] = useState(user.isActive);
  const [perms, setPerms] = useState<PermissionMap>(normalizePermissions(user.permissions));
  const [password, setPassword] = useState('');
  const { busy, run } = useAsyncAction('users-update');

  const submit = () => {
    if (!fullName.trim()) return notify('error', t('validation.required'));
    if (password && password.length < 8) return notify('error', t('validation.passwordLength'));
    void run(async () => {
      await api.updateSubUser({
        uid: user.uid,
        fullName: fullName.trim(),
        permissions: normalizePermissions(perms),
        isActive,
        ...(password ? { password } : {}),
      });
      notify('success', t('common.saved'));
      onClose();
    });
  };

  return (
    <Modal
      open
      size="lg"
      title={t('users.edit', { name: user.fullName })}
      onClose={onClose}
      busy={busy}
      footer={
        <Button loading={busy} onClick={submit}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="stack">
        <FormGrid cols={3}>
          <TextInput label={t('auth.fullName')} required value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} />
          <TextInput label={t('auth.email')} value={user.email} disabled dir="ltr" />
          <TextInput
            label={t('users.newPassword')}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t('users.newPasswordHint')}
          />
        </FormGrid>
        <Checkbox label={t('users.activeAccount')} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        <PermissionsEditor value={perms} onChange={setPerms} disabled={busy} />
      </div>
    </Modal>
  );
}
