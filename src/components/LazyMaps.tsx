import { lazy, Suspense, type ComponentProps } from 'react';

// Los mapas (Leaflet) se descargan solo cuando se muestran: la carta y la portada abren más rápido.
const LocationPickerImpl = lazy(() => import('./LocationPicker').then((m) => ({ default: m.LocationPicker })));
const LiveMapImpl = lazy(() => import('./LiveMap').then((m) => ({ default: m.LiveMap })));

const Loading = ({ h }: { h: number }) => <div className="map-loading" style={{ minHeight: h }}>Cargando mapa…</div>;

export function LocationPicker(props: ComponentProps<typeof LocationPickerImpl>) {
  return <Suspense fallback={<Loading h={60} />}><LocationPickerImpl {...props} /></Suspense>;
}
export function LiveMap(props: ComponentProps<typeof LiveMapImpl>) {
  return <Suspense fallback={<Loading h={props.height ?? 300} />}><LiveMapImpl {...props} /></Suspense>;
}
