import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// Direction-only, one-time per restaurant: sets the opening ledger baseline.
export default function InitialStock() {
  const { t } = useI18n();
  const { locations, locationId, setLocationId } = useLocations();
  const [items, setItems] = useState([]);
  const [qty, setQty] = useState({}); // itemId -> string
  const [date, setDate] = useState(today());
  const [initialized, setInitialized] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/items').then((d) => setItems(d.items.filter((i) => i.isTracked)));
  }, []);

  const loadStatus = useCallback(() => {
    if (!locationId) return;
    setMsg(''); setError('');
    api.get(`/api/daily/initial-stock-status?locationId=${locationId}`).then((d) => setInitialized(d.initialized));
  }, [locationId]);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/api/daily/initial-stock', {
        locationId, date,
        items: Object.entries(qty).map(([itemId, q]) => ({ itemId: Number(itemId), qty: Number(q) || 0 })),
      });
      setMsg(`${t('initialstock.done')} (${d.items} articles, ${d.date})`);
      setInitialized(true);
    } catch (e) {
      setError(e.message);
      if (e.status === 409) setInitialized(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="topbar"><h1>{t('initialstock.title')}</h1></div>

      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>{t('initialstock.goLiveDate')}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={initialized} />
          </label>
          <div style={{ flex: 1 }} />
          <button onClick={submit} disabled={busy || initialized}>{t('initialstock.submit')}</button>
        </div>
        {initialized
          ? <p className="flag">🔒 {t('initialstock.locked')}</p>
          : <p className="muted">{t('initialstock.intro')}</p>}
        {msg && <p className="muted">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {!initialized && (
        <div className="card">
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>{t('common.item')}</th><th>{t('common.unit')}</th><th className="num">{t('common.qty')}</th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name}</td>
                    <td>{t(`units.${it.unit}`)}</td>
                    <td className="num">
                      <input className="qty" type="number" step="any" value={qty[it.id] ?? ''} placeholder="0"
                        onChange={(e) => setQty((q) => ({ ...q, [it.id]: e.target.value }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
