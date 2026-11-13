import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { PickedLocation } from '../lib/geo';
export type { PickedLocation };

/** Santa Anita, Lima: punto de partida si el cliente no comparte su GPS. */
const DEFAULT_CENTER: [number, number] = [-12.0433, -76.9714];

export { mapsUrlFor } from '../lib/geo';

/** Dirección sugerida a partir de las coordenadas (OpenStreetMap). */
export async function reverseGeocode(p: PickedLocation): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lng}&zoom=18&addressdetails=1&accept-language=es`);
    if (!r.ok) return '';
    const j = await r.json() as { address?: Record<string, string>; display_name?: string };
    const a = j.address ?? {};
    const street = [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(' ');
    const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.residential ?? '';
    const district = a.city_district ?? a.town ?? a.city ?? a.county ?? '';
    const parts = [street, area, district].filter(Boolean);
    return parts.length ? parts.join(', ') : (j.display_name ?? '').split(',').slice(0, 3).join(',').trim();
  } catch {
    return '';
  }
}

const pinIcon = L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [34, 44], iconAnchor: [17, 42] });

/**
 * Ubicación de entrega: toma el GPS del celular (con permiso del cliente) y muestra un mapa
 * donde el cliente mueve el pin hasta su puerta exacta.
 */
export function LocationPicker({ value, onChange, onAddress }: {
  value: PickedLocation | null;
  onChange: (p: PickedLocation) => void;
  onAddress: (address: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const [state, setState] = useState<'idle' | 'locating' | 'error' | 'map'>(value ? 'map' : 'idle');
  const [msg, setMsg] = useState('');

  const pick = async (p: PickedLocation) => {
    onChange(p);
    const a = await reverseGeocode(p);
    if (a) onAddress(a);
  };

  const locate = () => {
    if (!('geolocation' in navigator)) { setState('error'); setMsg('Tu celular no permite compartir la ubicación desde el navegador. Mueve el pin en el mapa.'); return; }
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setState('map'); void pick({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      (err) => {
        setState('error');
        setMsg(err.code === err.PERMISSION_DENIED
          ? 'No diste permiso para usar tu ubicación. Puedes activarlo en los ajustes del navegador, o mover el pin en el mapa.'
          : 'No se pudo obtener tu ubicación. Mueve el pin en el mapa hasta tu dirección.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  const showMap = state === 'map' || state === 'error';

  useEffect(() => {
    if (!showMap || !box.current || map.current) return;
    const center: [number, number] = value ? [value.lat, value.lng] : DEFAULT_CENTER;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(center, value ? 18 : 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    const mk = L.marker(center, { draggable: true, icon: pinIcon, keyboard: true, title: 'Tu ubicación' }).addTo(m);
    mk.on('dragend', () => { const ll = mk.getLatLng(); void pick({ lat: ll.lat, lng: ll.lng }); });
    m.on('click', (e: L.LeafletMouseEvent) => { mk.setLatLng(e.latlng); void pick({ lat: e.latlng.lat, lng: e.latlng.lng }); });
    map.current = m;
    marker.current = mk;
    return () => { m.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap]);

  // Cuando llega el GPS, mover mapa y pin.
  useEffect(() => {
    if (value && map.current && marker.current) {
      marker.current.setLatLng([value.lat, value.lng]);
      map.current.setView([value.lat, value.lng], Math.max(map.current.getZoom(), 17));
    }
  }, [value]);

  return (
    <div className="loc-picker">
      <button type="button" className="btn loc-btn block" onClick={locate} disabled={state === 'locating'}>
        {state === 'locating' ? 'Buscando tu ubicación…' : value ? '📍 Volver a usar mi ubicación actual' : '📍 Usar mi ubicación actual'}
      </button>
      {state === 'error' && <p className="err-text small">{msg}</p>}
      {showMap && (
        <>
          <div ref={box} className="loc-map" role="application" aria-label="Mapa: mueve el pin hasta tu puerta" />
          <p className="muted small">Mueve el pin o toca el mapa para marcar tu puerta exacta.</p>
        </>
      )}
      {!showMap && state !== 'locating' && (
        <button type="button" className="link small" onClick={() => setState('map')}>Prefiero marcarla en el mapa</button>
      )}
    </div>
  );
}
