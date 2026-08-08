import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useBusinessDay } from '../lib/businessday.js';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const addDay = (ymd) => {
  if (!ymd) return ymd;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// "Commander Emballage" — a manager enters packaging quantities during their
// business day. What they order is for the NEXT day (order day = business day + 1),
// so the manager sees their business day but the data feeds the next-day order that
// Direction reviews on the Commandes page. Blank = skipped (not sent).
export default function Emballage() {
  const { t } = useI18n();
  const { isDirection } = useAuth();
  const businessDay = useBusinessDay();
  const { locations, locationId, setLocationId } = useLocations();
  const [date, setDate] = useState(today()); // the manager's BUSINESS day (shown)
  const [rows, setRows] = useState([]);
  const [qty, setQty] = useState({});
  const [confirmedLock, setConfirmedLock] = useState(false);
  const [msg, setMsg] = useState('');

  const orderDate = addDay(date); // the order this feeds (next day)
  const locStr = () => { const l = locations.find((x) => x.id === locationId); return l ? `${l.code} — ${l.name}` : ''; };

  const load = useCallback(() => {
    if (!locationId || !date) return;
    setMsg('');
    api.get(`/api/packaging?locationId=${locationId}&date=${addDay(date)}`).then((d) => {
      setRows(d.rows);
      setConfirmedLock(d.locked);
      const q = {};
      d.rows.forEach((r) => { if (r.orderedQty != null) q[r.itemId] = String(r.orderedQty); });
      setQty(q);
    });
  }, [locationId, date]);
  useEffect(() => { load(); }, [load]);
  // The manager always works on the current business day; Direction can change it.
  useEffect(() => { if (businessDay) setDate(businessDay); }, [businessDay]);

  const readOnly = !!businessDay && !isDirection && date !== businessDay;
  const locked = confirmedLock || readOnly; // locked if order already sent OR a past day

  const save = async () => {
    if (!window.confirm(t('confirm.order', { loc: locStr(), date: orderDate }))) return;
    await api.put('/api/packaging', {
      locationId, date: orderDate,
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
          <label>{t('common.date')}<input type="date" value={date} disabled={!isDirection} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <p className="muted">{t('emballage.hint')}</p>
        <p className="flag">📦 {t('emballage.forOrder', { date: orderDate })}</p>
        {readOnly && <p className="flag">🔒 {t('common.readOnlyDay')}</p>}
        {confirmedLock && !readOnly && <p className="flag">🔒 {t('emballage.locked')}</p>}
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
