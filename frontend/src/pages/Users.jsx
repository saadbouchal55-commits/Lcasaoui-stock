import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useLocations, ExportButton } from '../components/LocationPicker.jsx';

const blankForm = { username: '', password: '', role: 'MANAGER', locationId: '' };

export default function Users() {
  const { t } = useI18n();
  const { user: me } = useAuth();
  const { locations } = useLocations();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api.get('/api/users').then((d) => setUsers(d.users));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setError(''); setMsg('');
    try {
      await api.post('/api/users', {
        username: form.username,
        password: form.password,
        role: form.role,
        locationId: form.role === 'MANAGER' ? Number(form.locationId) || null : null,
      });
      setMsg(`${form.username} créé. ${t('users.createdInfo')}`);
      setForm(blankForm);
      load();
    } catch (e) {
      setError(e.data?.fields ? `${e.message}` : e.message);
    }
  };

  const setActive = async (u, active) => {
    setError('');
    try {
      await api.put(`/api/users/${u.id}`, { role: u.role, locationId: u.locationId, active });
      load();
    } catch (e) { setError(e.message); }
  };

  const changeRole = async (u, role, locationId) => {
    setError('');
    try {
      await api.put(`/api/users/${u.id}`, { role, locationId: role === 'DIRECTION' ? null : locationId, active: u.active });
      load();
    } catch (e) { setError(e.message); }
  };

  const resetPassword = async (u) => {
    const pw = window.prompt(`Nouveau mot de passe temporaire pour ${u.username} (min. 8) :`);
    if (!pw) return;
    setError(''); setMsg('');
    try {
      await api.post(`/api/users/${u.id}/reset-password`, { password: pw });
      setMsg(`Mot de passe réinitialisé pour ${u.username}. Il devra le changer à la prochaine connexion.`);
    } catch (e) { setError(e.message); }
  };

  const locName = (id) => locations.find((l) => l.id === id)?.code ?? '—';

  return (
    <>
      <div className="topbar"><h1>{t('users.title')}</h1></div>

      <div className="card">
        <h2>{t('users.new')}</h2>
        <div className="row">
          <label>{t('auth.username')}<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label>{t('users.tempPassword')}<input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min. 8" /></label>
          <label>{t('users.role')}
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="MANAGER">{t('roles.MANAGER')}</option>
              <option value="ORDER_MANAGER">{t('roles.ORDER_MANAGER')}</option>
              <option value="DIRECTION">{t('roles.DIRECTION')}</option>
            </select>
          </label>
          {form.role === 'MANAGER' ? (
            <label>{t('common.location')}
              <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
              </select>
            </label>
          ) : (
            <span className="muted" style={{ alignSelf: 'center' }}>{t('users.noLocationForDirection')}</span>
          )}
          <button onClick={create}>{t('common.add')}</button>
        </div>
        {error && <p className="error">{error}</p>}
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: 1 }} />
          <ExportButton url="/api/users/export" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('auth.username')}</th><th>{t('users.role')}</th><th>{t('common.location')}</th>
                <th>{t('items.active')}</th><th>{t('users.mustChange')}</th><th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.5 }}>
                  <td>{u.username}{u.id === me.id && <span className="muted"> (vous)</span>}</td>
                  <td>
                    <select value={u.role} onChange={(e) => changeRole(u, e.target.value, u.locationId)}>
                      <option value="MANAGER">{t('roles.MANAGER')}</option>
                      <option value="ORDER_MANAGER">{t('roles.ORDER_MANAGER')}</option>
                      <option value="DIRECTION">{t('roles.DIRECTION')}</option>
                    </select>
                  </td>
                  <td>
                    {u.role === 'MANAGER' ? (
                      <select value={u.locationId ?? ''} onChange={(e) => changeRole(u, 'MANAGER', Number(e.target.value))}>
                        <option value="">—</option>
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
                      </select>
                    ) : (
                      <span className="muted">{t('common.all')}</span>
                    )}
                  </td>
                  <td>{u.active ? t('common.yes') : t('common.no')}</td>
                  <td>{u.mustChangePassword ? <span className="badge warn">{t('common.yes')}</span> : t('common.no')}</td>
                  <td>
                    <button className="link" onClick={() => resetPassword(u)}>{t('users.resetPassword')}</button>
                    {u.active
                      ? <button className="link" onClick={() => setActive(u, false)} disabled={u.id === me.id}>{t('common.delete')}</button>
                      : <button className="link" onClick={() => setActive(u, true)}>Réactiver</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
