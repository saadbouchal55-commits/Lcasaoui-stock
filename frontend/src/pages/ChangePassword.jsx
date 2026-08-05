import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';

// Shown full-screen when the account must change its password (first login),
// and reachable normally otherwise.
export default function ChangePassword({ forced = false }) {
  const { changePassword, logout } = useAuth();
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('Le nouveau mot de passe doit comporter au moins 8 caractères.');
    if (next !== confirm) return setError('Les mots de passe ne correspondent pas.');
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={forced ? 'login-wrap' : ''}>
      <form className="card login-card" onSubmit={submit}>
        <h2>Changer le mot de passe</h2>
        {forced && <p className="tagline">Pour votre sécurité, définissez un nouveau mot de passe avant de continuer.</p>}
        {done ? (
          <p className="muted">Mot de passe mis à jour.</p>
        ) : (
          <>
            <div className="field">
              <label>Mot de passe actuel</label>
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Nouveau mot de passe (min. 8)</label>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div className="field">
              <label>Confirmer</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy} style={{ width: '100%' }}>{t('common.save')}</button>
            {forced && (
              <button type="button" className="link" style={{ width: '100%', marginTop: 8 }} onClick={logout}>
                {t('nav.logout')}
              </button>
            )}
          </>
        )}
      </form>
    </div>
  );
}
