import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { ExportButton } from '../components/LocationPicker.jsx';

const UNIT_NOTES = ['g', 'kg', 'U', 'pc', 'L'];

export default function Recipes() {
  const { t } = useI18n();
  const [dishes, setDishes] = useState([]);
  const [foodItems, setFoodItems] = useState([]);
  const [editing, setEditing] = useState(null); // { dishId, name, lines: [] }
  const [newDish, setNewDish] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api.get('/api/recipes').then((d) => setDishes(d.dishes));
  useEffect(() => {
    load();
    api.get('/api/items').then((d) => setFoodItems(d.items.filter((i) => i.inRecipes && i.active)));
  }, []);

  const startEdit = (dish) => {
    setError(''); setMsg('');
    setEditing({
      dishId: dish.id,
      name: dish.name,
      lines: (dish.activeVersion?.lines || []).map((l) => ({ itemId: l.itemId, qty: String(l.qty), unitNote: l.unitNote || 'g' })),
    });
  };

  const addLine = () => setEditing((e) => ({ ...e, lines: [...e.lines, { itemId: foodItems[0]?.id, qty: '', unitNote: 'g' }] }));
  const removeLine = (i) => setEditing((e) => ({ ...e, lines: e.lines.filter((_, idx) => idx !== i) }));
  const setLine = (i, patch) => setEditing((e) => ({ ...e, lines: e.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  const saveVersion = async () => {
    setError(''); setMsg('');
    try {
      await api.post(`/api/recipes/dishes/${editing.dishId}/versions`, {
        lines: editing.lines
          .filter((l) => l.itemId && Number(l.qty) > 0)
          .map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty), unitNote: l.unitNote })),
      });
      setMsg(`Nouvelle version enregistrée pour ${editing.name}.`);
      setEditing(null);
      load();
    } catch (e) {
      setError(e.data?.detail || e.message);
    }
  };

  const createDish = async () => {
    if (!newDish.trim()) return;
    const d = await api.post('/api/recipes/dishes', { name: newDish.trim() });
    setNewDish('');
    await load();
    startEdit({ id: d.dish.id, name: d.dish.name, activeVersion: null });
  };

  return (
    <>
      <div className="topbar"><h1>{t('recipes.title')}</h1></div>
      <p className="tagline">{t('recipes.foodOnly')}</p>

      <div className="card">
        <div className="row">
          <label>{t('recipes.dish')} (nouveau)<input value={newDish} onChange={(e) => setNewDish(e.target.value)} /></label>
          <button className="secondary" onClick={createDish}>{t('common.add')}</button>
          <div style={{ flex: 1 }} />
          <ExportButton url="/api/recipes/export" />
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: editing ? '1fr 1fr' : '1fr', gap: 18 }}>
        <div className="card">
          <h2>{t('recipes.title')}</h2>
          <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>{t('recipes.dish')}</th><th className="num">{t('recipes.version')}</th><th>{t('common.actions')}</th></tr></thead>
              <tbody>
                {dishes.map((d) => (
                  <tr key={d.id} style={d.active ? undefined : { opacity: 0.5 }}>
                    <td>{d.name}</td>
                    <td className="num">{d.activeVersion ? `v${d.activeVersion.version}` : '—'}</td>
                    <td><button className="link" onClick={() => startEdit(d)}>{t('common.edit')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {editing && (
          <div className="card">
            <h2>{editing.name} — {t('recipes.newVersion')}</h2>
            <p className="muted">{t('recipes.lines')}</p>
            <table>
              <thead><tr><th>{t('common.item')}</th><th className="num">{t('common.qty')}</th><th>{t('recipes.recipeUnit')}</th><th></th></tr></thead>
              <tbody>
                {editing.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select value={l.itemId} onChange={(e) => setLine(i, { itemId: Number(e.target.value) })}>
                        {foodItems.map((it) => <option key={it.id} value={it.id}>{it.name} ({t(`units.${it.unit}`)})</option>)}
                      </select>
                    </td>
                    <td className="num"><input className="qty" type="number" step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                    <td>
                      <select value={l.unitNote} onChange={(e) => setLine(i, { unitNote: e.target.value })}>
                        {UNIT_NOTES.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td><button className="link" onClick={() => removeLine(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button className="secondary" onClick={addLine}>{t('common.add')}</button>
              <button onClick={saveVersion}>{t('recipes.newVersion')}</button>
              <button className="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        )}
      </div>
    </>
  );
}
