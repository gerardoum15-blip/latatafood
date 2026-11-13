import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DB } from '../types';
import { geocode } from './geo';
import { localCoords, localGeoQueries } from './rules';
import { cachedLocalGeo, localGeoVersion, saveLocalGeo, subscribeLocalGeo } from './localGeoCache';

const pending = new Set<string>();

/** Ubica solos los locales que aún no tienen coordenadas (buscando su dirección). Nadie tiene que hacerlo a mano. */
export function useLocalGeo(db: DB) {
  const v = useSyncExternalStore(subscribeLocalGeo, localGeoVersion);
  useEffect(() => {
    for (const l of db.locales) {
      if (localCoords(l)) continue;
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

const addrCache = new Map<string, { lat: number; lng: number } | null>();

/** Ubica una dirección escrita (sin GPS) para calcular el envío. Espera a que terminen de escribir. */
export function useAddressGeo(address: string, enabled: boolean): { lat: number; lng: number } | null {
  const q = address.trim().replace(/\s+/g, ' ');
  const key = q.toLowerCase();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || q.length < 8 || /^recojo|^mesa /i.test(q) || addrCache.has(key)) return;
    const t = setTimeout(() => {
      void geocode(/lima|per[uú]/i.test(q) ? q : `${q}, Lima, Perú`).then((p) => {
        // Solo vale si cae en Lima (cerca de los locales).
        addrCache.set(key, p && Math.abs(p.lat + 12.04) < 0.4 && Math.abs(p.lng + 76.97) < 0.4 ? p : null);
        setTick((n) => n + 1);
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [key, enabled]);
  return enabled ? addrCache.get(key) ?? null : null;
}
