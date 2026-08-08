import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useBusinessDay } from '../lib/businessday.js';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';
import { WasteTable } from '../components/WasteTable.jsx';
import { groupByZone } from '../lib/grouping.js';

const today = () => new Date().toISOString().slice(0, 10);

// "Déclarer le Stock" — blind nightly count of ALL tracked items (food + packaging),
// grouped by storage zone → subcategory (R → C → A) so staff count by location.
export default function Stock() {
  const { t } = useI18n();
  const { isDirection } = useAuth();
  const businessDay = useBusinessDay();
  const { locations, locationId, setLocationId } = useLocations();
  const [date, setDate] = useState(today());
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [status, setStatus] = useState(null);
  const [wasteRows, setWasteRows] = useState(null);
  const [collapsed, setCollapsed] = useState({}); // zone -> bool
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/api/items').then((d) => setItems(d.items.filter((i) => i.isTracked))); }, []);

  const load = useCallback(() => {
    if (!locationId || !date) return;
    setMsg(''); setWasteRows(null);
    api.get(`/api/daily/night-status?locationId=${locationId}&date=${date}`).then(setStatus);
    api.get(`/api/daily?locationId=${locationId}&date=${date}`).then((d) => {
      const c = {};
      (d.counts || []).forEach((x) => (c[x.itemId] = String(x.countedQty)));
      setCounts(c);
    });
  }, [locationId, date]);
  useEffect(() => { load(); }, [load]);

  const locStr = () => { const l = locations.find((x) => x.id === locationId); return l ? `${l.code} — ${l.name}` : ''; };

  const submit = async () => {
    if (!window.confirm(t('confirm.record', { loc: locStr(), date }))) return;
    setBusy(true); setMsg('');
    try {
      const d = await api.post('/api/daily/night-count', {
        locationId, date,
        counts: Object.entries(counts).map(([itemId, q]) => ({ itemId: Number(itemId), countedQty: q })).filter((x) => x.countedQty !== ''),
      });
      setWasteRows(d.rows || null);
      setMsg(t('stock.saved'));
      load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  useEffect(() => { if (businessDay) setDate(businessDay); }, [businessDay]);
  const readOnly = !!businessDay && !isDirection && date !== businessDay;

  // Initial stock is set ONLY by Direction (separate page). Here, block counting
  // if the restaurant isn't initialised yet, or if this is the initial day.
  const notInitialized = status && !status.initialized;
  const isInitialDay = status && status.isInitialDay;
  const blocked = readOnly || notInitialized || isInitialDay;

  const zones = groupByZone(items);
  const toggle = (z) => setCollapsed((c) => ({ ...c, [z]: !c[z] }));

  return (
    <>
      <div className="topbar"><h1>{t('nav.stock')}</h1></div>
      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>{t('common.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {status && <span className="badge green">{t('stock.closing')}</span>}
        </div>
        <p className="muted">{t('stock.blindHint')}</p>
        {readOnly && <p className="flag">🔒 {t('common.readOnlyDay')}</p>}
        {notInitialized && <p className="flag">⚠ {t('stock.notInitialized')}</p>}
        {isInitialDay && !notInitialized && <p className="flag">⚠ {t('stock.initialDay')}</p>}
        {msg && <p className="muted">{msg}</p>}
        <div className="actions"><button onClick={submit} disabled={busy || blocked}>{t('stock.saveCount')}</button></div>
      </div>

      {zones.map((zoneGrp) => (
        <div className="card" key={zoneGrp.zone}>
          <button className="zone-head" onClick={() => toggle(zoneGrp.zone)}>
            <span>{collapsed[zoneGrp.zone] ? '▸' : '▾'} {t(`zones.${zoneGrp.zone}`)}</span>
          </button>
          {!collapsed[zoneGrp.zone] && zoneGrp.subs.map((subGrp) => (
            <div key={subGrp.sub}>
              <h3 className="subcat">{subGrp.sub}</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>{t('common.item')}</th><th className="num">{t('waste.counted')}</th></tr></thead>
                  <tbody>
                    {subGrp.items.map((it) => (
                      <tr key={it.id}>
                        <td data-label={t('common.item')}>{it.name} <span className="muted">({t(`units.${it.unit}`)})</span></td>
                        <td className="num" data-label={t('waste.counted')}>
                          <input className="qty" type="number" inputMode="decimal" step="any" value={counts[it.id] ?? ''} disabled={blocked}
                            onChange={(e) => setCounts((c) => ({ ...c, [it.id]: e.target.value }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}

      {isDirection && wasteRows && (
        <div className="card"><h2>{t('waste.title')}</h2><WasteTable rows={wasteRows} /></div>
      )}

      <div className="actions" style={{ marginBottom: 24 }}><button onClick={submit} disabled={busy || blocked}>{t('stock.saveCount')}</button></div>
    </>
  );
}
