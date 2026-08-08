import { useEffect, useState } from 'react';
import { subscribeToast } from '../toast.js';
import { useI18n } from '../i18n.jsx';

// Faint, auto-dismissing confirmations shown bottom-corner. Fired from api.js on
// every successful save/action, so every page gets feedback with no extra wiring.
export function ToastHost() {
  const { t } = useI18n();
  const [items, setItems] = useState([]);

  useEffect(() => subscribeToast((toast) => {
    setItems((xs) => [...xs, toast]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== toast.id)), 2200);
  }), []);

  if (!items.length) return null;
  return (
    <div className="toast-host" aria-live="polite" role="status">
      {items.map((x) => <div key={x.id} className={`toast toast-${x.type}`}>{t(x.message)}</div>)}
    </div>
  );
}

export default ToastHost;
