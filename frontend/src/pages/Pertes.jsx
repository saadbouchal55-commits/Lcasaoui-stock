import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// "Déclarer les Pertes" — declare waste: raw ingredient (ITEM) or product (PRODUCT).
export default function Pertes() {
  const { t } = useI18n();
  const { locations, locationId, setLocationId } = useLocations();
  const [date, setDate] = useState(today());
  const [items, setItems] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [refType, setRefType] = useState('ITEM');
  const [refId, setRefId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [recent, setRecent] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/items').then((d) => setItems(d.items.filter((i) => i.isTracked)));
    api.get('/api/dishes').then((d) => setDishes(d.dishes));
  }, []);

  const loadRecent = useCallback(() => {
    const q = locationId ? `?locationId=${locationId}` : '';
    api.get(`/api/waste-declarations${q}`).then((d) => setRecent(d.declarations.slice(0, 15)));
  }, [locationId]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const options = refType === 'ITEM' ? items : dishes;

  const submit = async () => {
    setError(''); setMsg('');
    if (!refId || !(Number(qty) > 0)) { setError(t('errors.validation')); return; }
    try {
      await api.post('/api/waste-declarations', {
        locationId, date, refType,
        itemId: refType === 'ITEM' ? Number(refId) : undefined,
        dishId: refType === 'PRODUCT' ? Number(refId) : undefined,
        qty: Number(qty), reason,
      });
      setMsg(t('pertes.saved'));
      setRefId(''); setQty(''); setReason('');
      loadRecent();
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <div className="topbar"><h1>{t('nav.pertes')}</h1></div>

      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>{t('common.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="row">
          <label>{t('pertes.type')}
            <select value={refType} onChange={(e) => { setRefType(e.target.value); setRefId(''); }}>
              <option value="ITEM">{t('pertes.ingredient')}</option>
              <option value="PRODUCT">{t('pertes.product')}</option>
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>{refType === 'ITEM' ? t('common.item') : t('recipes.dish')}
            <select value={refId} onChange={(e) => setRefId(e.target.value)}>
              <option value="">—</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}{refType === 'ITEM' ? ` (${t(`units.${o.unit}`)})` : ''}</option>)}
            </select>
          </label>
          <label>{t('common.qty')}<input className="qty" type="number" inputMode="decimal" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        </div>
        <div className="row">
          <label style={{ flex: 1 }}>{t('pertes.reason')}
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('pertes.reasonPlaceholder')} />
          </label>
        </div>
        <div className="actions"><button onClick={submit}>{t('pertes.declare')}</button></div>
        {error && <p className="error">{error}</p>}
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card">
        <h2>{t('pertes.recent')}</h2>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('common.date')}</th><th>{t('common.item')}</th><th className="num">{t('common.qty')}</th><th>{t('pertes.reason')}</th></tr></thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.id}>
                  <td data-label={t('common.date')}>{d.date}</td>
                  <td data-label={t('common.item')}>{d.name} <span className="badge gray">{t(`pertes.${d.refType === 'ITEM' ? 'ingredient' : 'product'}`)}</span></td>
                  <td className="num" data-label={t('common.qty')}>{d.qty}{d.unit ? ` ${t(`units.${d.unit}`)}` : ''}</td>
                  <td data-label={t('pertes.reason')} className="muted">{d.reason}</td>
                </tr>
              ))}
              {recent.length === 0 && <tr><td colSpan={4} className="muted">{t('common.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
