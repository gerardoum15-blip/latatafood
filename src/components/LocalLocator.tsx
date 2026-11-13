import { useEffect, useState } from 'react';
import { mutate } from '../data/store';
import type { Local } from '../types';
import { geocode, type PickedLocation } from '../lib/geo';
import { localGeoQuery } from '../lib/rules';
import { LocationPicker } from './LazyMaps';
import { Modal } from './ui';

/** Ubicar el local en el mapa (busca su dirección; el administrador ajusta el pin y guarda). */
export function LocalLocatorButton({ local }: { local: Local }) {
  const [open, setOpen] = useState(false);
  const has = local.lat != null && local.lng != null;
  return (
    <>
      <button className={has ? 'btn small' : 'btn small primary'} onClick={() => setOpen(true)}>{has ? '📍 Ubicado · cambiar' : '📍 Ubicar en el mapa'}</button>
      {open && <LocatorModal local={local} onClose={() => setOpen(false)} />}
    </>
  );
}

function LocatorModal({ local, onClose }: { local: Local; onClose: () => void }) {
  const [pos, setPos] = useState<PickedLocation | null>(local.lat != null && local.lng != null ? { lat: local.lat, lng: local.lng } : null);
  const [searching, setSearching] = useState(!pos);
  useEffect(() => {
    if (pos) return;
    let alive = true;
    void geocode(localGeoQuery(local)).then((p) => { if (alive) { if (p) setPos(p); setSearching(false); } });
    return () => { alive = false; };
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal title={`Ubicar ${local.name}`} onClose={onClose} footer={
      <button className="btn primary block" disabled={!pos} onClick={() => { mutate((d) => { const l = d.locales.find((x) => x.id === local.id)!; l.lat = pos!.lat; l.lng = pos!.lng; }); onClose(); }}>Guardar ubicación del local</button>
    }>
      <p className="muted small">Busqué: <b>{localGeoQuery(local)}</b>. Mueve el pin hasta la puerta exacta del local (o usa tu GPS si estás ahí) y guarda.</p>
      {searching ? <p className="muted">Buscando la dirección…</p> : <LocationPicker value={pos} onChange={setPos} onAddress={() => undefined} />}
      {pos && <p className="muted small">Coordenadas: {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</p>}
    </Modal>
  );
}
