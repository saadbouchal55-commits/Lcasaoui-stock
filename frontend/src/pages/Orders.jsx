import { useEffect, useState, useCallback } from 'react';
import { api, downloadExport } from '../api.js';
import { useI18n } from '../i18n.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// Order lifecycle screen for Direction / Order Manager. Shows both restaurants.
// GENERATED → (HELD if guardrail) → edit → CONFIRMED_SENT (record + learning).
export default function Orders() {
  const { t } = useI18n();
  const [date, setDate] = useState(today());
  const [orders, setOrders] = useState([]);
  const [pkgEdits, setPkgEdits] = useState({}); // `${loc}:${itemId}` -> string
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    setMsg('');
    api.get(`/api/orders?date=${date}`).then((d) => {
      setOrders(d.orders);
      const p = {};
      d.orders.forEach((o) => o.packaging.forEach((r) => {
        if (r.orderedQty != null) p[`${o.locationId}:${r.itemId}`] = String(r.orderedQty);
      }));
      setPkgEdits(p);
    });
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const generate = async (locationId) => {
    try {
      await api.post('/api/orders/generate', { locationId, date });
      setMsg('Commande générée.');
    } catch (e) { setMsg(e.message); }
    load();
  };

  const saveLine = async (lineId, patch) => {
    if (!lineId) return;
    await api.put(`/api/orders/line/${lineId}`, patch);
    load();
  };

  const savePackaging = async (o) => {
    const items = o.packaging.map((r) => ({ itemId: r.itemId, qty: pkgEdits[`${o.locationId}:${r.itemId}`] ?? '' }));
    await api.put('/api/orders/packaging', { locationId: o.locationId, date, items });
    setMsg('Emballages enregistrés.');
    load();
  };

  const confirm = async (locationId) => {
    if (!window.confirm("Confirmer que cette commande a bien été envoyée ? (elle devient le registre officiel et la base d'apprentissage)")) return;
    try {
      await api.post('/api/orders/confirm', { locationId, date });
      setMsg('Envoi confirmé.');
    } catch (e) { setMsg(e.message); }
    load();
  };

  return (
    <>
      <div className="topbar"><h1>{t('orders.title')}</h1></div>
      <div className="card">
        <div className="row">
          <label>{t('common.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <p className="tagline">{t('app.tagline')}</p>
        {msg && <p className="muted">{msg}</p>}
      </div>

      {orders.map((o) => {
        const confirmed = o.status === 'CONFIRMED_SENT';
        const editable = !confirmed;
        return (
          <div className="card" key={o.locationId}>
            <div className="row" style={{ alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>{o.locationCode} — {o.locationName}</h2>
              <span className={`badge ${confirmed ? 'green' : o.status === 'HELD' ? 'warn' : 'gray'}`}>
                {t(`orderStatus.${o.status}`)}
              </span>
              <div style={{ flex: 1 }} />
              {!confirmed && <button className="secondary" onClick={() => generate(o.locationId)}>{o.exists ? t('orders.regenerateFood') : t('orders.generate')}</button>}
              {o.exists && !confirmed && <button onClick={() => confirm(o.locationId)}>{t('orders.confirmSent')}</button>}
              <button className="secondary" onClick={() => downloadExport(`/api/orders/export?locationId=${o.locationId}&date=${date}`)}>{t('common.export')}</button>
            </div>

            {o.status === 'HELD' && o.holdReason && (
              <p className="error" style={{ marginTop: 8 }}>⚠ {t('orders.heldAlert')} {o.holdReason}</p>
            )}
            {confirmed && <p className="muted">{t('orders.confirmedInfo')}</p>}
            {!o.exists && !confirmed && <p className="muted">{t('orders.notGenerated')}</p>}

            {/* FOOD */}
            <h3 style={{ marginBottom: 6 }}>{t('orders.food')}</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.item')}</th><th>{t('common.unit')}</th>
                    <th className="num">Stock</th>
                    <th className="num">{t('orders.suggested')}</th>
                    <th className="num">{t('orders.ordered')}</th>
                    <th>{t('orders.flag')}</th>
                    <th>{t('orders.reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.food.map((r) => (
                    <tr key={r.itemId} style={r.flagged ? { background: 'var(--warn-bg)' } : undefined}>
                      <td>{r.name}</td>
                      <td>{t(`units.${r.unit}`)}</td>
                      <td className="num muted">{r.currentStock}</td>
                      <td className="num muted">{r.suggestedQty}</td>
                      <td className="num">
                        {editable && r.lineId ? (
                          <input className="qty" type="number" step="any" defaultValue={r.orderedQty}
                            onBlur={(e) => { const v = e.target.value; if (v !== '' && Number(v) !== r.orderedQty) saveLine(r.lineId, { orderedQty: Number(v) }); }} />
                        ) : (
                          <span style={{ fontWeight: 600 }}>{r.orderedQty}</span>
                        )}
                      </td>
                      <td>
                        {editable && r.lineId
                          ? <button className="link" onClick={() => saveLine(r.lineId, { flagged: !r.flagged })}>{r.flagged ? `⚑ ${t('orders.flagged')}` : t('orders.flag')}</button>
                          : (r.flagged ? `⚑ ${t('orders.flagged')}` : '')}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* PACKAGING */}
            <h3 style={{ margin: '14px 0 6px' }}>{t('orders.packaging')}</h3>
            <p className="muted">{t('orders.packagingNote')}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.item')}</th><th>{t('common.unit')}</th>
                    <th className="num">{t('orders.hint')} ({t('orders.hintAvg')})</th>
                    <th className="num">{t('orders.hintLast')}</th>
                    <th className="num">{t('orders.manualQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.packaging.map((r) => {
                    const key = `${o.locationId}:${r.itemId}`;
                    return (
                      <tr key={r.itemId}>
                        <td>{r.name}</td>
                        <td>{t(`units.${r.unit}`)}</td>
                        <td className="num muted" title={`${r.ordersInWindow} commandes récentes`}>{r.hintAvg || '—'}</td>
                        <td className="num muted">{r.hintLast || '—'}</td>
                        <td className="num">
                          {editable ? (
                            <input className="qty" type="number" step="any" value={pkgEdits[key] ?? ''} placeholder="—"
                              onChange={(e) => setPkgEdits((p) => ({ ...p, [key]: e.target.value }))} />
                          ) : (r.orderedQty ?? '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {editable && <div style={{ marginTop: 10 }}><button className="secondary" onClick={() => savePackaging(o)}>{t('orders.savePackaging')}</button></div>}
          </div>
        );
      })}
    </>
  );
}
