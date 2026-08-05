import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { ExportButton } from '../components/LocationPicker.jsx';

const blank = { name: '', unit: 'KG', packSize: '', yieldPct: '', category: 'INGREDIENT', isTracked: true, inRecipes: true };

export default function Items() {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ units: [], categories: [] });
  const [includeInactive, setIncludeInactive] = useState(false);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    const params = new URLSearchParams();
    if (includeInactive) params.set('includeInactive', 'true');
    if (q) params.set('q', q);
    api.get(`/api/items?${params}`).then((d) => setItems(d.items));
  };
  useEffect(() => { api.get('/api/meta/config').then(setMeta); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [includeInactive, q]);

  const startEdit = (it) => {
    setEditingId(it.id);
    setForm({ ...it, packSize: it.packSize ?? '', yieldPct: it.yieldPct ?? '' });
    setError('');
  };
  const reset = () => { setEditingId(null); setForm(blank); setError(''); };

  const save = async () => {
    setError('');
    const payload = {
      ...form,
      packSize: form.packSize === '' ? null : Number(form.packSize),
      yieldPct: form.yieldPct === '' ? null : Number(form.yieldPct),
    };
    try {
      if (editingId) await api.put(`/api/items/${editingId}`, payload);
      else await api.post('/api/items', payload);
      reset();
      load();
    } catch (e) {
      setError(e.data?.fields ? `${t('errors.validation')}: ${e.data.fields.join(', ')}` : e.message);
    }
  };

  const setActive = async (it, active) => {
    await api.post(`/api/items/${it.id}/${active ? 'reactivate' : 'deactivate'}`);
    load();
  };

  return (
    <>
      <div className="topbar"><h1>{t('items.title')}</h1></div>

      <div className="card">
        <h2>{editingId ? t('common.edit') : t('items.new')}</h2>
        <div className="row">
          <label>{t('items.name')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t('common.unit')}
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {meta.units.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
            </select>
          </label>
          <label>{t('items.packSize')}<input type="number" value={form.packSize} onChange={(e) => setForm({ ...form, packSize: e.target.value })} /></label>
          <label>{t('items.yield')}<input type="number" step="any" value={form.yieldPct} onChange={(e) => setForm({ ...form, yieldPct: e.target.value })} /></label>
          <label>Catégorie
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {meta.categories.map((c) => <option key={c} value={c}>{t(`category.${c}`)}</option>)}
            </select>
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={form.inRecipes} onChange={(e) => setForm({ ...form, inRecipes: e.target.checked })} /> {t('items.inRecipes')}
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={form.isTracked} onChange={(e) => setForm({ ...form, isTracked: e.target.checked })} /> {t('items.tracked')}
          </label>
          <button onClick={save}>{t('common.save')}</button>
          {editingId && <button className="secondary" onClick={reset}>{t('common.cancel')}</button>}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <label>{t('common.search')}<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Inclure inactifs
          </label>
          <div style={{ flex: 1 }} />
          <ExportButton url={`/api/items/export?${includeInactive ? 'includeInactive=true&' : ''}${q ? `q=${encodeURIComponent(q)}` : ''}`} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('items.name')}</th><th>{t('common.unit')}</th><th className="num">{t('items.packSize')}</th>
                <th className="num">{t('items.yield')}</th><th>Catégorie</th><th>{t('items.inRecipes')}</th>
                <th>{t('items.tracked')}</th><th>{t('items.active')}</th><th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={it.active ? undefined : { opacity: 0.5 }}>
                  <td>{it.name}</td>
                  <td>{t(`units.${it.unit}`)}</td>
                  <td className="num">{it.packSize ?? '—'}</td>
                  <td className="num">{it.yieldPct ?? '—'}</td>
                  <td>{t(`category.${it.category}`)}</td>
                  <td>{it.inRecipes ? t('common.yes') : t('common.no')}</td>
                  <td>{it.isTracked ? t('common.yes') : t('common.no')}</td>
                  <td>{it.active ? t('common.yes') : t('common.no')}</td>
                  <td>
                    <button className="link" onClick={() => startEdit(it)}>{t('common.edit')}</button>
                    {it.active
                      ? <button className="link" onClick={() => setActive(it, false)}>{t('common.delete')}</button>
                      : <button className="link" onClick={() => setActive(it, true)}>Réactiver</button>}
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
