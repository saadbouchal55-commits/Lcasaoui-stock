import { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { useI18n } from '../i18n.jsx';

/** Location selector. Managers see only their restaurant (auto-selected). */
export function useLocations(onReady) {
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState(null);

  useEffect(() => {
    api.get('/api/meta/locations').then((d) => {
      setLocations(d.locations);
      if (d.locations.length && locationId == null) {
        const first = d.locations[0].id;
        setLocationId(first);
        onReady?.(first);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { locations, locationId, setLocationId };
}

export function LocationPicker({ locations, locationId, onChange }) {
  const { t } = useI18n();
  return (
    <label>
      {t('common.location')}
      <select
        value={locationId ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={locations.length <= 1}
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.code} — {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ExportButton({ url }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadExport(url);
        } finally {
          setBusy(false);
        }
      }}
    >
      {t('common.export')}
    </button>
  );
}
