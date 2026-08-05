import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';

export default function Buffers() {
  const { t } = useI18n();
  const { locations, locationId, setLocationId } = useLocations();
  const [items, setItems] = useState([]);
  const [pct, setPct] = useState({}); // itemId -> string
  const [msg, setMsg] = useState('');

  useEffect(() => { api.get('/api/items').then((d) => setItems(d.items.filter((i) => i.isTracked))); }, []);

  const load = useCallback(() => {
    if (!locationId) return;
    api.get(`/api/buffers?locationId=${locationId}`).then((d) => {
      const m = {};
      d.buffers.forEach((b) => (m[b.itemId] = String(b.pct)));
      setPct(m);
    });
  }, [locationId]);
  useEffect(() => { load(); }, [load]);

  const save = async (itemId) => {
    await api.put('/api/buffers', { locationId, itemId, pct: Number(pct[itemId] || 0) });
    setMsg('Marge enregistrée.');
  };

  return (
    <>
      <div className="topbar"><h1>{t('nav.buffers')}</h1></div>
      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('common.item')}</th><th>{t('common.unit')}</th><th className="num">Marge %</th><th></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td>{t(`units.${it.unit}`)}</td>
                  <td className="num">
                    <input className="qty" type="number" step="any" value={pct[it.id] ?? ''}
                      onChange={(e) => setPct((p) => ({ ...p, [it.id]: e.target.value }))} placeholder="0" />
                  </td>
                  <td><button className="link" onClick={() => save(it.id)}>{t('common.save')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
