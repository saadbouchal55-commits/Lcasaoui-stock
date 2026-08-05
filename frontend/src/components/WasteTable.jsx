import { useI18n } from '../i18n.jsx';

// Direction-only variance table. Shows declared ingredient waste separately and
// the unexplained gap = expected − counted − declared.
export function WasteTable({ rows }) {
  const { t } = useI18n();
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('common.item')}</th><th>{t('common.unit')}</th>
            <th className="num">{t('daily.opening')}</th>
            <th className="num">{t('daily.received')}</th>
            <th className="num">{t('waste.consumption')}</th>
            <th className="num">{t('waste.expected')}</th>
            <th className="num">{t('waste.counted')}</th>
            <th className="num">{t('waste.declared')}</th>
            <th className="num">{t('waste.unexplained')}</th>
            <th>{t('waste.flags')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId}>
              <td data-label={t('common.item')}>{r.name}</td>
              <td data-label={t('common.unit')}>{t(`units.${r.unit}`)}</td>
              <td className="num" data-label={t('daily.opening')}>{r.opening ?? '—'}</td>
              <td className="num" data-label={t('daily.received')}>{r.received}</td>
              <td className="num" data-label={t('waste.consumption')}>{r.consumption}</td>
              <td className="num" data-label={t('waste.expected')}>{r.expectedClosing ?? '—'}</td>
              <td className="num" data-label={t('waste.counted')}>{r.counted ?? '—'}</td>
              <td className="num" data-label={t('waste.declared')}>{r.declaredWaste || 0}</td>
              <td className="num" data-label={t('waste.unexplained')} style={{ fontWeight: 600 }}>{r.waste ?? '—'}</td>
              <td data-label={t('waste.flags')}>{(r.flags || []).map((f) => <span key={f} className="flag">⚠ {t(`flags.${f}`)} </span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default WasteTable;
