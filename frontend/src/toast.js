// Lightweight global toast bus. Lets non-React code (api.js) fire a faint
// on-screen "done" notification; <ToastHost> subscribes and renders them.
let seq = 0;
let lastMsg = null;
let lastAt = 0;
const listeners = new Set();

// message may be an i18n key (translated by ToastHost) or a raw string.
export function toast(message, type = 'success') {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  // Collapse duplicate bursts (e.g. a save that fires two requests).
  if (message === lastMsg && now - lastAt < 600) return;
  lastMsg = message;
  lastAt = now;
  const t = { id: ++seq, message, type };
  listeners.forEach((fn) => fn(t));
}

export function subscribeToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export default toast;
