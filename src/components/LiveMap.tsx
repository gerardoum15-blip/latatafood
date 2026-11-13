import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { MapPoint } from '../lib/geo';
export type { MapPoint };

const icon = (kind: MapPoint['kind'], label: string) => L.divIcon({
  className: `live-pin ${kind}`,
  html: `<span class="dot">${kind === 'client' ? '🏠' : '🛵'}</span><span class="tag">${label.replace(/[<>&]/g, '')}</span>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

/** Mapa con puntos que se mueven en vivo (drivers y, opcionalmente, el cliente). */
export function LiveMap({ points, height = 300, follow = true }: { points: MapPoint[]; height?: number; follow?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const fitted = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true }).setView([-12.045, -76.97], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    map.current = m;
    const ms = markers.current;
    return () => { m.remove(); map.current = null; ms.clear(); };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      const cur = markers.current.get(p.id);
      if (cur) { cur.setLatLng([p.lat, p.lng]); cur.setIcon(icon(p.kind, p.label)); }
      else markers.current.set(p.id, L.marker([p.lat, p.lng], { icon: icon(p.kind, p.label), title: p.label }).addTo(m));
    }
    for (const [id, mk] of markers.current) if (!seen.has(id)) { mk.remove(); markers.current.delete(id); }
    if (points.length && (follow || !fitted.current)) {
      const b = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      if (points.length === 1) m.setView(b.getCenter(), Math.max(m.getZoom(), 16));
      else m.fitBounds(b, { padding: [40, 40], maxZoom: 17 });
      fitted.current = true;
    }
  }, [points, follow]);

  return <div ref={box} className="live-map" style={{ height }} role="application" aria-label="Mapa en vivo" />;
}
