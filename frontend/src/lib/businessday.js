import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Current business day ('YYYY-MM-DD', 11:00→11:00 Morocco time) from the server.
// Managers may only edit this day; earlier/later days are view-only.
export function useBusinessDay() {
  const [businessDay, setBusinessDay] = useState(null);
  useEffect(() => {
    api.get('/api/meta/business-day').then((d) => setBusinessDay(d.businessDay)).catch(() => {});
  }, []);
  return businessDay;
}

export default useBusinessDay;
