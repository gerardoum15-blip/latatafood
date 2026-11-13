import { useEffect, useSyncExternalStore } from 'react';
import type { DB } from '../types';
import { geocode } from './geo';
import { localGeoQueries } from './rules';
import { cachedLocalGeo, localGeoVersion, saveLocalGeo, subscribeLocalGeo } from './localGeoCache';

const pending = new Set<string>();

/** Ubica solos los locales que aún no tienen coordenadas (buscando su dirección). Nadie tiene que hacerlo a mano. */
export function useLocalGeo(db: DB) {
  const v = useSyncExternalStore(subscribeLocalGeo, localGeoVersion);
  useEffect(() => {
    for (const l of db.locales) {
      if (l.lat != null && l.lng != null) continue;
      const qs = localGeoQueries(l);
      if (cachedLocalGeo(l.id, qs[0]) || pending.has(l.id)) continue;
      pending.add(l.id);
      void (async () => {
        for (const q of qs) {
          const p = await geocode(q);
          if (p) { saveLocalGeo(l.id, qs[0], p); break; }
        }
        pending.delete(l.id);
      })();
    }
  }, [db.locales]);
  return v;
}
