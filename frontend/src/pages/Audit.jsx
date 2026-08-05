import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { ExportButton } from '../components/LocationPicker.jsx';

export default function Audit() {
  const { t } = useI18n();
  const [logs, setLogs] = useState([]);
  const [entity, setEntity] = useState('');

  useEffect(() => {
    const url = entity ? `/api/audit?entity=${entity}` : '/api/audit';
    api.get(url).then((d) => setLogs(d.logs));
  }, [entity]);

  return (
    <>
      <div className="topbar"><h1>{t('nav.audit')}</h1></div>
      <div className="card">
        <div className="row">
          <label>Entité
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {['item', 'recipe', 'dish', 'stock', 'order', 'buffer'].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <div style={{ flex: 1 }} />
          <ExportButton url={entity ? `/api/audit/export?entity=${entity}` : '/api/audit/export'} />
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Utilisateur</th><th>Entité</th><th>ID</th><th>Action</th><th>Détails</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.createdAt).toLocaleString('fr-FR')}</td>
                  <td>{l.userId ?? '—'}</td>
                  <td>{l.entity}</td>
                  <td>{l.entityId}</td>
                  <td>{l.action}</td>
                  <td className="muted" style={{ fontSize: 12, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.newValue || l.oldValue || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
