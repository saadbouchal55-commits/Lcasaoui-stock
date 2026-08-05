import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';
import { WasteTable } from './Daily.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// "Comptage du soir" — the nightly starting point.
// First night ever at a restaurant = baseline (no waste). Every night after =
// closing count -> waste -> becomes tomorrow's opening.
export default function NightCount() {
  const { t } = useI18n();
  const { isDirection } = useAuth();
  const { locations, locationId, setLocationId } = useLocations();
  const [date, setDate] = useState(today());
  const [foodItems, setFoodItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [opening, setOpening] = useState({});
  const [received, setReceived] = useState({});
  const [status, setStatus] = useState(null); // {isBaseline, hasSales, status}
  const [wasteRows, setWasteRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/items').then((d) => setFoodItems(d.items.filter((i) => i.inRecipes && i.isTracked)));
  }, []);

  const load = useCallback(() => {
    if (!locationId || !date) return;
    setMsg(''); setWasteRows(null);
    api.get(`/api/daily/night-status?locationId=${locationId}&date=${date}`).then(setStatus);
    api.get(`/api/daily?locationId=${locationId}&date=${date}`).then((d) => {
      setOpening(d.opening || {});
      setReceived(d.received || {});
      const c = {};
      d.counts.forEach((x) => (c[x.itemId] = String(x.countedQty)));
      setCounts(c);
    });
  }, [locationId, date]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setBusy(true);
    setMsg('');
    try {
      const d = await api.post('/api/daily/night-count', {
        locationId, date,
        counts: Object.entries(counts).map(([itemId, q]) => ({ itemId: Number(itemId), countedQty: q })).filter((x) => x.countedQty !== ''),
      });
      if (d.mode === 'baseline') {
        setMsg("Stock initial enregistré. Il servira d'ouverture pour demain. À partir de demain, ce comptage calculera aussi le gaspillage.");
      } else {
        setWasteRows(d.rows);
        setMsg('Comptage de clôture enregistré, gaspillage calculé et reporté comme ouverture de demain.');
      }
      load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const isBaseline = status?.isBaseline;
  // Reference columns (opening/received) are only ever shown to Direction — a
  // manager/shift-leader counts blind. (The API also omits these for them.)
  const showRef = isDirection && !isBaseline;

  return (
    <>
      <div className="topbar"><h1>{t('nav.nightcount')}</h1></div>

      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>{t('common.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {status && (
            <span className={`badge ${isBaseline ? 'gray' : 'green'}`}>
              {isBaseline ? 'Stock initial (baseline)' : 'Comptage de clôture'}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={submit} disabled={busy}>
            {isBaseline ? 'Enregistrer le stock initial' : 'Enregistrer & calculer le gaspillage'}
          </button>
        </div>
        {isBaseline ? (
          <p className="muted">Première utilisation pour ce restaurant : saisissez le stock réel compté ce soir. Aucun gaspillage n'est calculé — ce comptage devient l'ouverture de demain.</p>
        ) : (
          <p className="muted">
            Comptez le stock de clôture. Assurez-vous que les ventes du jour sont saisies (via {t('nav.daily')}) — le gaspillage = attendu − compté.
            {status && !status.hasSales && <span className="flag"> ⚠ Aucune vente saisie pour ce jour.</span>}
          </p>
        )}
        {msg && <p className="muted" style={{ marginBottom: 0 }}>{msg}</p>}
      </div>

      <div className="card">
        <h2>{t('daily.counts')}</h2>
        <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{t('common.item')}</th>
                {showRef && <th className="num">{t('daily.opening')}</th>}
                {showRef && <th className="num">{t('daily.received')}</th>}
                <th className="num">{t('waste.counted')}</th>
              </tr>
            </thead>
            <tbody>
              {foodItems.map((it) => (
                <tr key={it.id}>
                  <td>{it.name} <span className="muted">({t(`units.${it.unit}`)})</span></td>
                  {showRef && <td className="num muted">{fmt(opening[it.id])}</td>}
                  {showRef && <td className="num muted">{fmt(received[it.id])}</td>}
                  <td className="num">
                    <input className="qty" type="number" step="any" value={counts[it.id] ?? ''}
                      onChange={(e) => setCounts((c) => ({ ...c, [it.id]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {wasteRows && (
        <div className="card">
          <h2>{t('waste.title')}</h2>
          <WasteTable rows={wasteRows} t={t} />
        </div>
      )}
    </>
  );
}

function fmt(v) {
  if (v == null) return '—';
  return Math.round(Number(v) * 1000) / 1000;
}
