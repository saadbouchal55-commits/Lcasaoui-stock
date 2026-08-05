import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useLocations, LocationPicker } from '../components/LocationPicker.jsx';

// Declared-waste view. Manager: own restaurant, read-only. Direction: both.
export default function PertesView() {
  const { t } = useI18n();
  const { isDirection } = useAuth();
  const { locations, locationId, setLocationId } = useLocations();
  const [decls, setDecls] = useState([]);

  const load = useCallback(() => {
    // Direction may filter by location; manager is pinned server-side.
    const q = isDirection && locationId ? `?locationId=${locationId}` : '';
    api.get(`/api/waste-declarations${q}`).then((d) => setDecls(d.declarations));
  }, [isDirection, locationId]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="topbar"><h1>{t('nav.pertesView')}</h1></div>
      {isDirection && (
        <div className="card">
          <div className="row">
            <LocationPicker locations={locations} locationId={locationId} onChange={setLocationId} />
            <span className="muted">{t('pertesView.directionNote')}</span>
          </div>
        </div>
      )}
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                {isDirection && <th>{t('common.location')}</th>}
                <th>{t('pertes.type')}</th>
                <th>{t('common.item')}</th>
                <th className="num">{t('common.qty')}</th>
                <th>{t('pertes.reason')}</th>
                <th>{t('pertesView.by')}</th>
              </tr>
            </thead>
            <tbody>
              {decls.map((d) => (
                <tr key={d.id}>
                  <td data-label={t('common.date')}>{d.date}</td>
                  {isDirection && <td data-label={t('common.location')}>{d.locationCode}</td>}
                  <td data-label={t('pertes.type')}><span className="badge gray">{t(`pertes.${d.refType === 'ITEM' ? 'ingredient' : 'product'}`)}</span></td>
                  <td data-label={t('common.item')}>{d.name}</td>
                  <td className="num" data-label={t('common.qty')}>{d.qty}{d.unit ? ` ${t(`units.${d.unit}`)}` : ''}</td>
                  <td data-label={t('pertes.reason')} className="muted">{d.reason}</td>
                  <td data-label={t('pertesView.by')}>{d.by}</td>
                </tr>
              ))}
              {decls.length === 0 && <tr><td colSpan={isDirection ? 7 : 6} className="muted">{t('common.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
