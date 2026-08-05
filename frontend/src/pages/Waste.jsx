import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useLocations, LocationPicker, ExportButton } from '../components/LocationPicker.jsx';
import { WasteTable } from '../components/WasteTable.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function Waste() {
  const { t } = useI18n();
  const { locations, locationId, setLocationId } = useLocations();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState([]);
  const [productWaste, setProductWaste] = useState([]);

  const load = useCallback(() => {
    if (!locationId) return;
    api.get(`/api/daily/waste?locationId=${locationId}&from=${from}&to=${to}`).then((d) => {
      setRows(d.rows);
      setProductWaste(d.productWaste || []);
    });
  }, [locationId, from, to]);

  useEffect(() => { load(); }, [load]);

  const exportUrl = `/api/daily/waste/export?locationId=${locationId}&from=${from}&to=${to}`;

  return (
    <>
      <div className="topbar"><h1>{t('waste.title')}</h1></div>
      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>{t('waste.from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{t('waste.to')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div style={{ flex: 1 }} />
          <ExportButton url={exportUrl} />
        </div>
        <p className="muted">{t('waste.formula')}</p>
      </div>

      <div className="card">
        <h2>{t('waste.ingredientVariance')}</h2>
        {rows.length ? <WasteTable rows={rows} /> : <p className="muted">{t('common.none')}</p>}
      </div>

      {/* Product-level declared waste, kept separate (never exploded into ingredients). */}
      <div className="card">
        <h2>{t('waste.productWaste')}</h2>
        {productWaste.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('common.date')}</th><th>{t('recipes.dish')}</th><th className="num">{t('common.qty')}</th><th>{t('pertes.reason')}</th></tr></thead>
              <tbody>
                {productWaste.map((p, i) => (
                  <tr key={i}>
                    <td data-label={t('common.date')}>{p.date}</td>
                    <td data-label={t('recipes.dish')}>{p.name}</td>
                    <td className="num" data-label={t('common.qty')}>{p.qty}</td>
                    <td data-label={t('pertes.reason')} className="muted">{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t('common.none')}</p>}
      </div>
    </>
  );
}
