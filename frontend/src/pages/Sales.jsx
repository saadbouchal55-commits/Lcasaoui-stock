import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useBusinessDay } from '../lib/businessday.js';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// "Déclarer les Ventes" — quantities sold per product that day.
export default function Sales() {
  const { t } = useI18n();
  const { isDirection } = useAuth();
  const businessDay = useBusinessDay();
  const { locations, locationId, setLocationId } = useLocations();
  const [date, setDate] = useState(today());
  const [dishes, setDishes] = useState([]);
  const [sales, setSales] = useState({});
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState('');

  // Everyone lands on the current business day by default (before 11:00 that is
  // still yesterday); Direction can then change it, managers are locked to it.
  useEffect(() => { if (businessDay) setDate(businessDay); }, [businessDay]);
  const readOnly = !!businessDay && !isDirection && date !== businessDay;

  useEffect(() => { api.get('/api/dishes').then((d) => setDishes(d.dishes)); }, []);

  const load = useCallback(() => {
    if (!locationId || !date) return;
    setMsg('');
    api.get(`/api/daily?locationId=${locationId}&date=${date}`).then((d) => {
      const s = {};
      (d.sales || []).forEach((x) => (s[x.dishId] = String(x.qtySold)));
      setSales(s);
    });
  }, [locationId, date]);
  useEffect(() => { load(); }, [load]);

  const locStr = () => { const l = locations.find((x) => x.id === locationId); return l ? `${l.code} — ${l.name}` : ''; };

  const save = async () => {
    if (!window.confirm(t('confirm.record', { loc: locStr(), date }))) return;
    await api.put('/api/daily/sales', {
      locationId, date,
      sales: Object.entries(sales).map(([dishId, q]) => ({ dishId: Number(dishId), qtySold: Number(q) })).filter((x) => x.qtySold > 0),
    });
    setMsg(t('sales.saved'));
  };

  const importCsv = async () => {
    if (!window.confirm(t('confirm.record', { loc: locStr(), date }))) return;
    const d = await api.post('/api/daily/import-sales', { locationId, date, csv });
    setMsg(`${t('sales.imported')}: ${d.imported}` + (d.skipped?.length ? ` — ${t('sales.skipped')}: ${d.skipped.join(', ')}` : ''));
    setCsv('');
    load();
  };

  return (
    <>
      <div className="topbar"><h1>{t('nav.sales')}</h1></div>
      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>{t('common.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {readOnly && <p className="flag">🔒 {t('common.readOnlyDay')}</p>}
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card">
        <h2>{t('daily.sales')}</h2>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('recipes.dish')}</th><th className="num">{t('common.qty')}</th></tr></thead>
            <tbody>
              {dishes.map((d) => (
                <tr key={d.id}>
                  <td data-label={t('recipes.dish')}>{d.name}</td>
                  <td className="num" data-label={t('common.qty')}>
                    <input className="qty" type="number" inputMode="numeric" min="0" value={sales[d.id] ?? ''} disabled={readOnly}
                      onChange={(e) => setSales((s) => ({ ...s, [d.id]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!readOnly && <div className="actions"><button onClick={save}>{t('common.save')}</button></div>}
      </div>

      {!readOnly && (
      <div className="card">
        <h2>{t('daily.import_sales')}</h2>
        <p className="muted">CSV: date, location, dish, qty_sold</p>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div className="actions"><button className="secondary" onClick={importCsv} disabled={!csv.trim()}>{t('daily.import_sales')}</button></div>
      </div>
      )}
    </>
  );
}
