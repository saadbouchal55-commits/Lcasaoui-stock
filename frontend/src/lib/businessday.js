import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Server day context: the business/service day ('YYYY-MM-DD', 11:00→11:00 Morocco
// time) used by Ventes/Stock/Pertes, and the order/production day (07:00→07:00)
// used by the order pages (Commandes + Commander Emballage). Non-Direction users
// may only edit their current day; earlier/later days are view-only.
export function useDayContext() {
  const [days, setDays] = useState({ businessDay: null, orderDay: null });
  useEffect(() => {
    api.get('/api/meta/business-day')
      .then((d) => setDays({ businessDay: d.businessDay, orderDay: d.orderDay }))
      .catch(() => {});
  }, []);
  return days;
}

// Business/service day (11:00→11:00) — Ventes, Stock, Pertes.
export function useBusinessDay() {
  return useDayContext().businessDay;
}

// Order/production day (07:00→07:00) — Commandes, Commander Emballage.
export function useOrderDay() {
  return useDayContext().orderDay;
}

export default useBusinessDay;
