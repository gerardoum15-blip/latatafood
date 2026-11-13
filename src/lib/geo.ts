/** Enlace de Google Maps para unas coordenadas (sin cargar el mapa). */
export const mapsUrlFor = (p: { lat: number; lng: number }) => `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
export interface PickedLocation { lat: number; lng: number }
export interface MapPoint { id: string; lat: number; lng: number; label: string; kind: 'driver' | 'driver-old' | 'client' }
