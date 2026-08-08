import { useEffect, useState, useCallback } from 'react';
import { api, downloadExport } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useOrderDay } from '../lib/businessday.js';
import { groupByZone } from '../lib/grouping.js';

const today = () => new Date().toISOString().slice(0, 10);

// Order lifecycle for Direction / Order Manager. A restaurant selector chooses:
//  - a specific restaurant → full workflow (generate/edit/packaging/confirm),
//  - "Total" → read-only sum across all restaurants (kitchen prep), export only.
export default function Orders() {
  const { t } = useI18n();
  const orderDay = useOrderDay();
  const [date, setDate] = useState(today());
  const [groups, setGroups] = useState([]);
  const [view, setView] = useState(null); // locationId (number) or 'ALL'
  const [combined, setCombined] = useState([]);
  const [items, setItems] = useState([]);
  const [pkgEdits, setPkgEdits] = useState({});
  const [addSel, setAddSel] = useState({});
  const [msg, setMsg] = useState('');

  useEffect(() => { api.get('/api/orders/items').then((d) => setItems(d.items)); }, []);
  // Orders roll over at 07:00 (production start): default to the current order day.
  useEffect(() => { if (orderDay) setDate(orderDay); }, [orderDay]);

  const load = useCallback(() => {
    setMsg('');
    api.get(`/api/orders?date=${date}`).then((d) => {
      setGroups(d.orders);
      setView((v) => (v == null && d.orders.length ? d.orders[0].locationId : v));
      const p = {};
      d.orders.forEach((g) => (g.primary.packaging || []).forEach((r) => {
        if (r.orderedQty != null) p[`${g.locationId}:${r.itemId}`] = String(r.orderedQty);
      }));
      setPkgEdits(p);
    });
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const loadCombined = useCallback(() => {
    if (view !== 'ALL') return;
    api.get(`/api/orders/combined?date=${date}`).then((d) => setCombined(d.rows));
  }, [view, date]);
  useEffect(() => { loadCombined(); }, [loadCombined]);

  const refresh = () => { load(); loadCombined(); };
  const generate = async (locationId) => { try { await api.post('/api/orders/generate', { locationId, date }); setMsg('OK'); } catch (e) { setMsg(e.message); } refresh(); };
  const saveLine = async (lineId, patch) => { if (lineId) { await api.put(`/api/orders/line/${lineId}`, patch); refresh(); } };
  const saveFood = async (locationId, itemId, qty) => { await api.put('/api/orders/food-line', { locationId, date, itemId, qty: Number(qty) }); refresh(); };
  const savePackaging = async (g) => {
    await api.put('/api/orders/packaging', { locationId: g.locationId, date, items: g.primary.packaging.map((r) => ({ itemId: r.itemId, qty: pkgEdits[`${g.locationId}:${r.itemId}`] ?? '' })) });
    setMsg(t('orders.savePackaging')); refresh();
  };
  const locStr = () => { const g = groups.find((x) => x.locationId === view); return g ? `${g.locationCode} — ${g.locationName}` : ''; };
  const confirm = async (orderId) => {
    if (!orderId || !window.confirm(t('confirm.send', { loc: locStr(), date }))) return;
    try { await api.post('/api/orders/confirm', { orderId }); setMsg(t('orders.confirmSent')); } catch (e) { setMsg(e.message); }
    refresh();
  };
  const newSupplement = async (locationId) => { await api.post('/api/orders/supplementary', { locationId, date }); load(); };
  const addLine = async (orderId) => {
    const sel = addSel[orderId] || {};
    if (!sel.itemId || !(Number(sel.qty) > 0)) return;
    await api.post(`/api/orders/${orderId}/line`, { itemId: Number(sel.itemId), qty: Number(sel.qty) });
    setAddSel((s) => ({ ...s, [orderId]: { itemId: '', qty: '' } }));
    refresh();
  };
  const removeLine = async (lineId) => { await api.delete(`/api/orders/line/${lineId}`); refresh(); };

  const selected = view !== 'ALL' ? groups.find((g) => g.locationId === view) : null;

  return (
    <>
      <div className="topbar"><h1>{t('orders.title')}</h1></div>
      <div className="card">
        <div className="row">
          <label>{t('common.location')}
            <select value={view ?? ''} onChange={(e) => setView(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
              {groups.map((g) => <option key={g.locationId} value={g.locationId}>{g.locationCode} — {g.locationName}</option>)}
              <option value="ALL">{t('orders.allLocations')}</option>
            </select>
          </label>
          <label>{t('common.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <p className="tagline">{t('app.tagline')}</p>
        {msg && <p className="muted">{msg}</p>}
      </div>

      {/* ── TOTAL (all restaurants) — read-only kitchen prep ─────────────────── */}
      {view === 'ALL' && (
        <div className="card">
          <div className="row" style={{ alignItems: 'center' }}>
            <strong>{t('orders.combinedTitle')}</strong>
            <div style={{ flex: 1 }} />
            <button className="secondary" onClick={() => downloadExport(`/api/orders/bon-combined?date=${date}`)}>{t('orders.bonCombined')}</button>
          </div>
          <p className="muted">{t('orders.combinedNote')}</p>
          {combined.length === 0 && <p className="muted">{t('common.none')}</p>}
          {groupByZone(combined).map((zg) => zg.subs.map((sg) => (
            <div key={`c-${zg.zone}-${sg.sub}`}>
              <h4 className="subcat">{t(`zones.${zg.zone}`)} — {sg.sub}</h4>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>{t('common.item')}</th><th>{t('common.unit')}</th><th className="num">{t('orders.suggested')}</th><th className="num">{t('orders.ordered')}</th></tr></thead>
                  <tbody>
                    {sg.items.map((r) => (
                      <tr key={r.itemId}>
                        <td data-label={t('common.item')}>{r.name}</td>
                        <td data-label={t('common.unit')}>{t(`units.${r.unit}`)}</td>
                        <td className="num muted" data-label={t('orders.suggested')}>{r.suggested || '—'}</td>
                        <td className="num" data-label={t('orders.ordered')} style={{ fontWeight: 600 }}>{r.ordered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )))}
        </div>
      )}

      {/* ── One restaurant — full workflow ──────────────────────────────────── */}
      {selected && (() => {
        const g = selected;
        const p = g.primary;
        const pConfirmed = p.status === 'CONFIRMED_SENT';
        return (
          <div>
            {/* PRIMARY ORDER */}
            <div className="card">
              <div className="row" style={{ alignItems: 'center' }}>
                <strong>{t('orders.primary')}</strong>
                <span className={`badge ${pConfirmed ? 'green' : p.status === 'HELD' ? 'warn' : 'gray'}`}>{t(`orderStatus.${p.status}`)}</span>
                <div style={{ flex: 1 }} />
                {!pConfirmed && <button className="secondary" onClick={() => generate(g.locationId)}>{p.exists ? t('orders.regenerateFood') : t('orders.generate')}</button>}
                {p.id && !pConfirmed && <button onClick={() => confirm(p.id)}>{t('orders.confirmSent')}</button>}
                <button className="secondary" onClick={() => downloadExport(`/api/orders/bon?locationId=${g.locationId}&date=${date}&version=proposed`)}>{t('orders.bonProposed')}</button>
                {pConfirmed && <button className="secondary" onClick={() => downloadExport(`/api/orders/bon?locationId=${g.locationId}&date=${date}&version=sent`)}>{t('orders.bonSent')}</button>}
              </div>
              {p.status === 'HELD' && p.holdReason && <p className="error">⚠ {t('orders.heldAlert')} {p.holdReason}</p>}
              {pConfirmed && <p className="muted">{t('orders.confirmedInfo')}</p>}

              <h3>{t('orders.food')}</h3>
              {groupByZone(p.food).map((zg) => zg.subs.map((sg) => (
                <div key={`f-${zg.zone}-${sg.sub}`}>
                  <h4 className="subcat">{t(`zones.${zg.zone}`)} — {sg.sub}</h4>
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>{t('common.item')}</th><th>{t('common.unit')}</th><th className="num">{t('orders.suggested')}</th><th className="num">{t('orders.ordered')}</th></tr></thead>
                      <tbody>
                        {sg.items.map((r) => (
                          <tr key={r.itemId} style={r.lowConfidence ? { background: 'var(--warn-bg)' } : undefined}>
                            <td data-label={t('common.item')} title={r.reason}>
                              {r.name}
                              {r.lowConfidence && <span className="flag" title={r.confidenceReasons}> ⚠ {t('orders.lowConfidence')}</span>}
                            </td>
                            <td data-label={t('common.unit')}>{t(`units.${r.unit}`)}</td>
                            <td className="num muted" data-label={t('orders.suggested')} title={r.reason}>{r.suggestedQty}</td>
                            <td className="num" data-label={t('orders.ordered')}>
                              {!pConfirmed
                                ? <input key={`${r.itemId}-${r.orderedQty}`} className="qty" type="number" inputMode="decimal" step="any" defaultValue={r.orderedQty}
                                    onBlur={(e) => { const v = e.target.value; if (v !== '' && Number(v) !== r.orderedQty) saveFood(g.locationId, r.itemId, v); }} />
                                : <strong>{r.orderedQty}</strong>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )))}

              <h3>{t('orders.packaging')}</h3>
              {groupByZone(p.packaging).map((zg) => zg.subs.map((sg) => (
                <div key={`p-${zg.zone}-${sg.sub}`}>
                  <h4 className="subcat">{t(`zones.${zg.zone}`)} — {sg.sub}</h4>
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>{t('common.item')}</th><th>{t('common.unit')}</th><th className="num">{t('orders.hintAvg')}</th><th className="num">{t('orders.manualQty')}</th></tr></thead>
                      <tbody>
                        {sg.items.map((r) => {
                          const key = `${g.locationId}:${r.itemId}`;
                          return (
                            <tr key={r.itemId}>
                              <td data-label={t('common.item')}>{r.name}</td>
                              <td data-label={t('common.unit')}>{t(`units.${r.unit}`)}</td>
                              <td className="num muted" data-label={t('orders.hintAvg')}>{r.hintAvg || '—'}</td>
                              <td className="num" data-label={t('orders.manualQty')}>
                                {!pConfirmed
                                  ? <input className="qty" type="number" inputMode="decimal" step="any" value={pkgEdits[key] ?? ''} placeholder="—" onChange={(e) => setPkgEdits((q) => ({ ...q, [key]: e.target.value }))} />
                                  : (r.orderedQty ?? '—')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )))}
              {!pConfirmed && <div className="actions"><button className="secondary" onClick={() => savePackaging(g)}>{t('orders.savePackaging')}</button></div>}
            </div>

            {/* SUPPLEMENTARY ORDERS */}
            <div className="card">
              <div className="row" style={{ alignItems: 'center' }}>
                <strong>{t('orders.supplementary')}</strong>
                <div style={{ flex: 1 }} />
                <button className="secondary" onClick={() => newSupplement(g.locationId)}>＋ {t('orders.newSupplement')}</button>
              </div>

              {g.supplements.length === 0 && <p className="muted">—</p>}
              {g.supplements.map((s) => {
                const sConfirmed = s.status === 'CONFIRMED_SENT';
                const sel = addSel[s.id] || {};
                return (
                  <div key={s.id} className="card" style={{ background: '#fafbfa' }}>
                    <div className="row" style={{ alignItems: 'center' }}>
                      <strong>{t('orders.supplementTitle')} #{s.seq}</strong>
                      <span className={`badge ${sConfirmed ? 'green' : 'gray'}`}>{t(`orderStatus.${s.status}`)}</span>
                      <div style={{ flex: 1 }} />
                      {!sConfirmed && s.lines.length > 0 && <button onClick={() => confirm(s.id)}>{t('orders.confirmSent')}</button>}
                    </div>
                    <div className="table-wrap">
                      <table className="data">
                        <thead><tr><th>{t('common.item')}</th><th>{t('common.unit')}</th><th className="num">{t('orders.ordered')}</th><th></th></tr></thead>
                        <tbody>
                          {s.lines.map((l) => (
                            <tr key={l.lineId}>
                              <td data-label={t('common.item')}>{l.name}</td>
                              <td data-label={t('common.unit')}>{t(`units.${l.unit}`)}</td>
                              <td className="num" data-label={t('orders.ordered')}>
                                {!sConfirmed
                                  ? <input className="qty" type="number" inputMode="decimal" step="any" defaultValue={l.orderedQty}
                                      onBlur={(e) => { const v = e.target.value; if (v !== '' && Number(v) !== l.orderedQty) saveLine(l.lineId, { orderedQty: Number(v) }); }} />
                                  : l.orderedQty}
                              </td>
                              <td>{!sConfirmed && <button className="link" onClick={() => removeLine(l.lineId)}>✕</button>}</td>
                            </tr>
                          ))}
                          {s.lines.length === 0 && <tr><td colSpan={4} className="muted">{t('orders.noLines')}</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    {!sConfirmed && (
                      <div className="row" style={{ marginTop: 8 }}>
                        <label style={{ flex: 1, minWidth: 160 }}>{t('orders.selectItem')}
                          <select value={sel.itemId ?? ''} onChange={(e) => setAddSel((a) => ({ ...a, [s.id]: { ...sel, itemId: e.target.value } }))}>
                            <option value="">—</option>
                            {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({t(`units.${it.unit}`)})</option>)}
                          </select>
                        </label>
                        <label>{t('common.qty')}<input className="qty" type="number" inputMode="decimal" step="any" value={sel.qty ?? ''} onChange={(e) => setAddSel((a) => ({ ...a, [s.id]: { ...sel, qty: e.target.value } }))} /></label>
                        <button className="secondary" onClick={() => addLine(s.id)}>{t('orders.addItem')}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </>
  );
}
