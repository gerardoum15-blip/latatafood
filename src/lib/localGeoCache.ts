/** Ubicación de cada local, encontrada sola a partir de su dirección (se guarda en el celular). */
const KEY = 'latatafood-locales-geo';
type Geo = Record<string, { lat: number; lng: number; q: string }>;
let cache: Geo = {};
try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') as Geo; } catch { cache = {}; }
const listeners = new Set<() => void>();
let version = 0;

export const cachedLocalGeo = (id: string, q: string) => (cache[id]?.q === q ? cache[id] : undefined);
export function saveLocalGeo(id: string, q: string, p: { lat: number; lng: number }) {
  cache = { ...cache, [id]: { lat: p.lat, lng: p.lng, q } };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* sin espacio */ }
  version++;
  listeners.forEach((l) => l());
}
export const subscribeLocalGeo = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const localGeoVersion = () => version;
