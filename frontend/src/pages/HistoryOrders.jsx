import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useLocations, ExportButton } from '../components/LocationPicker.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// Direction-only: browse past orders across restaurants over a date range. Read-only.
export default function HistoryOrders() {
  const { t } = useI18n();
  const { locations } = useLocations();
  const [loc, setLoc] = useState(''); // '' = all restaurants
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState([]);

  const qs = `from=${from}&to=${to}${loc ? `&locationId=${loc}` : ''}`;
  const load = useCallback(() => {
    api.get(`/api/history/orders?from=${from}&to=${to}${loc ? `&locationId=${loc}` : ''}`).then((d) => setRows(d.rows));
  }, [from, to, loc]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="topbar"><h1>{t('history.ordersTitle')}</h1></div>
      <div className="card">
        <div className="row">
          <label>{t('common.location')}
            <select value={loc} onChange={(e) => setLoc(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
            </select>
          </label>
          <label>{t('waste.from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{t('waste.to')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div style={{ flex: 1 }} />
          <ExportButton url={`/api/history/orders/export?${qs}`} />
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              <th>{t('common.date')}</th><th>{t('common.location')}</th><th>{t('common.item')}</th>
              <th>{t('common.unit')}</th><th className="num">{t('orders.ordered')}</th><th>{t('orders.status')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td data-label={t('common.date')}>{r.date}</td>
                  <td data-label={t('common.location')}>{r.location}</td>
                  <td data-label={t('common.item')}>{r.item}</td>
                  <td data-label={t('common.unit')}>{t(`units.${r.unit}`)}</td>
                  <td className="num" data-label={t('orders.ordered')}>{r.ordered}</td>
                  <td data-label={t('orders.status')}><span className={`badge ${r.status === 'CONFIRMED_SENT' ? 'green' : r.status === 'HELD' ? 'warn' : 'gray'}`}>{t(`orderStatus.${r.status}`)}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="muted">{t('common.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
