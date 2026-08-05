import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function Daily() {
  const { t } = useI18n();
  const { isDirection } = useAuth();
  const { locations, locationId, setLocationId } = useLocations();
  const [date, setDate] = useState(today());

  const [dishes, setDishes] = useState([]);
  const [foodItems, setFoodItems] = useState([]);
  const [sales, setSales] = useState({}); // dishId -> qty string
  const [counts, setCounts] = useState({}); // itemId -> qty string
  const [received, setReceived] = useState({});
  const [opening, setOpening] = useState({});
  const [status, setStatus] = useState('open');
  const [wasteRows, setWasteRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [csv, setCsv] = useState('');

  // static lists
  useEffect(() => {
    api.get('/api/dishes').then((d) => setDishes(d.dishes));
    api.get('/api/items').then((d) => setFoodItems(d.items.filter((i) => i.inRecipes && i.isTracked)));
  }, []);

  const load = useCallback(() => {
    if (!locationId || !date) return;
    setMsg('');
    setWasteRows(null);
    api.get(`/api/daily?locationId=${locationId}&date=${date}`).then((d) => {
      setStatus(d.status);
      setOpening(d.opening || {});
      setReceived(d.received || {});
      const s = {};
      d.sales.forEach((x) => (s[x.dishId] = String(x.qtySold)));
      setSales(s);
      const c = {};
      d.counts.forEach((x) => (c[x.itemId] = String(x.countedQty)));
      setCounts(c);
    });
  }, [locationId, date]);

  useEffect(() => { load(); }, [load]);

  const saveSales = async () => {
    await api.put('/api/daily/sales', {
      locationId, date,
      sales: Object.entries(sales).map(([dishId, q]) => ({ dishId: Number(dishId), qtySold: Number(q) })).filter((x) => x.qtySold > 0),
    });
    setMsg('Ventes enregistrées.');
  };

  const saveCounts = async () => {
    await api.put('/api/daily/counts', {
      locationId, date,
      counts: Object.entries(counts).map(([itemId, q]) => ({ itemId: Number(itemId), countedQty: q })).filter((x) => x.countedQty !== ''),
    });
    setMsg('Comptage enregistré.');
  };

  const reconcile = async () => {
    await saveSales();
    await saveCounts();
    const d = await api.post('/api/daily/reconcile', { locationId, date });
    setWasteRows(d.rows);
    setStatus('reconciled');
    setMsg('Gaspillage calculé et enregistré dans le journal de stock.');
  };

  const importCsv = async () => {
    const d = await api.post('/api/daily/import-sales', { locationId, date, csv });
    setMsg(`Importé: ${d.imported} plats.` + (d.skipped?.length ? ` Ignorés: ${d.skipped.join(', ')}` : ''));
    setCsv('');
    load();
  };

  return (
    <>
      <div className="topbar">
        <h1>{t('daily.title')}</h1>
      </div>

      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>
            {t('common.date')}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <span className={`badge ${status === 'reconciled' ? 'green' : 'gray'}`}>
            {status === 'reconciled' ? t('daily.status_reconciled') : t('daily.status_open')}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={reconcile}>{t('daily.reconcile')}</button>
        </div>
        {msg && <p className="muted" style={{ marginBottom: 0 }}>{msg}</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* Sales */}
        <div className="card">
          <h2>{t('daily.sales')}</h2>
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>{t('recipes.dish')}</th><th className="num">{t('common.qty')}</th></tr></thead>
              <tbody>
                {dishes.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td className="num">
                      <input className="qty" type="number" min="0" value={sales[d.id] ?? ''}
                        onChange={(e) => setSales((s) => ({ ...s, [d.id]: e.target.value }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10 }}><button className="secondary" onClick={saveSales}>{t('common.save')}</button></div>
        </div>

        {/* Counts */}
        <div className="card">
          <h2>{t('daily.counts')}</h2>
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{t('common.item')}</th>
                  {isDirection && <th className="num">{t('daily.opening')}</th>}
                  {isDirection && <th className="num">{t('daily.received')}</th>}
                  <th className="num">{t('waste.counted')}</th>
                </tr>
              </thead>
              <tbody>
                {foodItems.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name} <span className="muted">({t(`units.${it.unit}`)})</span></td>
                    {isDirection && <td className="num muted">{fmt(opening[it.id])}</td>}
                    {isDirection && <td className="num muted">{fmt(received[it.id])}</td>}
                    <td className="num">
                      <input className="qty" type="number" step="any" value={counts[it.id] ?? ''}
                        onChange={(e) => setCounts((c) => ({ ...c, [it.id]: e.target.value }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10 }}><button className="secondary" onClick={saveCounts}>{t('common.save')}</button></div>
        </div>
      </div>

      {/* Reconcile result — Direction only (blind counting for managers) */}
      {isDirection && wasteRows && (
        <div className="card">
          <h2>{t('waste.title')}</h2>
          <WasteTable rows={wasteRows} t={t} />
        </div>
      )}

      {/* Import */}
      <div className="card">
        <h2>{t('daily.import_sales')}</h2>
        <p className="muted">Collez le CSV export du POS (colonnes: date, location, dish, qty_sold).</p>
        <textarea style={{ width: '100%', minHeight: 90, font: 'inherit' }} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div style={{ marginTop: 8 }}><button className="secondary" onClick={importCsv} disabled={!csv.trim()}>{t('daily.import_sales')}</button></div>
      </div>
    </>
  );
}

function fmt(v) {
  if (v == null) return '—';
  return Math.round(Number(v) * 1000) / 1000;
}

export function WasteTable({ rows, t }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('common.item')}</th><th>{t('common.unit')}</th>
            <th className="num">{t('daily.opening')}</th>
            <th className="num">{t('daily.received')}</th>
            <th className="num">{t('waste.consumption')}</th>
            <th className="num">{t('waste.expected')}</th>
            <th className="num">{t('waste.counted')}</th>
            <th className="num">{t('waste.waste')}</th>
            <th>{t('waste.flags')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId}>
              <td>{r.name}</td>
              <td>{t(`units.${r.unit}`)}</td>
              <td className="num">{r.opening ?? '—'}</td>
              <td className="num">{r.received}</td>
              <td className="num">{r.consumption}</td>
              <td className="num">{r.expectedClosing ?? '—'}</td>
              <td className="num">{r.counted ?? '—'}</td>
              <td className="num" style={{ fontWeight: 600 }}>{r.waste ?? '—'}</td>
              <td>{(r.flags || []).map((f) => <span key={f} className="flag" title={t(`flags.${f}`)}>⚠ {t(`flags.${f}`)} </span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
