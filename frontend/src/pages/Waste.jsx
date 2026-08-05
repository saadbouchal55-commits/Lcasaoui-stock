import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useLocations, LocationPicker, ExportButton } from '../components/LocationPicker.jsx';
import { WasteTable } from './Daily.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function Waste() {
  const { t } = useI18n();
  const { locations, locationId, setLocationId } = useLocations();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState([]);

  const load = useCallback(() => {
    if (!locationId) return;
    api.get(`/api/daily/waste?locationId=${locationId}&from=${from}&to=${to}`).then((d) => setRows(d.rows));
  }, [locationId, from, to]);

  useEffect(() => { load(); }, [load]);

  const exportUrl = `/api/daily/waste/export?locationId=${locationId}&from=${from}&to=${to}`;

  return (
    <>
      <div className="topbar"><h1>{t('waste.title')}</h1></div>
      <div className="card">
        <div className="row">
          <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
          <label>{t('common.date')} (début)<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{t('common.date')} (fin)<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div style={{ flex: 1 }} />
          <ExportButton url={exportUrl} />
        </div>
      </div>
      <div className="card">
        {rows.length ? <WasteTable rows={rows} t={t} /> : <p className="muted">{t('common.none')}</p>}
      </div>
    </>
  );
}
