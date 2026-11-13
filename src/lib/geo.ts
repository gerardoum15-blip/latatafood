/** Enlace de Google Maps para unas coordenadas (sin cargar el mapa). */
export const mapsUrlFor = (p: { lat: number; lng: number }) => `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
export interface PickedLocation { lat: number; lng: number }
export interface MapPoint { id: string; lat: number; lng: number; label: string; kind: 'driver' | 'driver-old' | 'client' }

/** Busca coordenadas de una dirección (OpenStreetMap, desde el navegador). */
export async function geocode(q: string): Promise<PickedLocation | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=pe&accept-language=es&q=${encodeURIComponent(q)}`);
    if (!r.ok) return null;
    const j = await r.json() as { lat: string; lon: string }[];
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  } catch {
    return null;
  }
}
