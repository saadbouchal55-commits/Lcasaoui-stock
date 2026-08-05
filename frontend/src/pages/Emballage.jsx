import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// "Commander Emballage" — manager enters packaging/consumable order quantities.
// Non-binding history hint; blank = skipped (not sent). Food ordering is elsewhere.
export default function Emballage() {
  const { t } = useI18n();
  const { locations, locationId, setLocationId } = useLocations();
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState([]);
  const [qty, setQty] = useState({});
  const [locked, setLocked] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (!locationId || !date) return;
    setMsg('');
    api.get(`/api/packaging?locationId=${locationId}&date=${date}`).then((d) => {
      setRows(d.rows);
      setLocked(d.locked);
      const q = {};
      d.rows.forEach((r) => { if (r.orderedQty != null) q[r.itemId] = String(r.orderedQty); });
      setQty(q);
    });
  }, [locationId, date]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    await api.put('/api/packaging', {
      locationId, date,
      items: rows.map((r) => ({ itemId: r.itemId, qty: qty[r.itemId] ?? '' })),
    });
    setMsg(t('emballage.saved'));
    load();
  };

  return (
    <>
      <div className="topbar"><h1>{t('nav.emballage')}</h1></div>
      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>{t('common.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <p className="muted">{t('emballage.hint')}</p>
        {locked && <p className="flag">🔒 {t('emballage.locked')}</p>}
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('common.item')}</th><th>{t('common.unit')}</th>
                <th className="num">{t('orders.hintAvg')}</th>
                <th className="num">{t('orders.hintLast')}</th>
                <th className="num">{t('orders.manualQty')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td data-label={t('common.item')}>{r.name}</td>
                  <td data-label={t('common.unit')}>{t(`units.${r.unit}`)}</td>
                  <td className="num muted" data-label={t('orders.hintAvg')} title={`${r.ordersInWindow}`}>{r.hintAvg || '—'}</td>
                  <td className="num muted" data-label={t('orders.hintLast')}>{r.hintLast || '—'}</td>
                  <td className="num" data-label={t('orders.manualQty')}>
                    <input className="qty" type="number" inputMode="decimal" step="any" value={qty[r.itemId] ?? ''} placeholder="—"
                      disabled={locked} onChange={(e) => setQty((q) => ({ ...q, [r.itemId]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!locked && <div className="actions"><button onClick={save}>{t('emballage.save')}</button></div>}
      </div>
    </>
  );
}
