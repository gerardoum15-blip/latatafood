import { useEffect, useState, useSyncExternalStore } from 'react';
import { fetchRequestStatus, type RequestStatus } from '../data/cloud';
import { useDb } from '../data/store';
import { Modal } from '../components/ui';

const KEY = 'latatafood-seguimiento';
type Tracked = { id: string; at: number };
const listeners = new Set<() => void>();

function read(): Tracked[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as Tracked[]).filter((t) => Date.now() - t.at < 24 * 3600000); } catch { return []; }
}
let cache = read();

/** Guarda el pedido enviado para que el cliente pueda ver su estado (24 horas). */
export function rememberTracking(id: string) {
  cache = [{ id, at: Date.now() }, ...cache.filter((t) => t.id !== id)].slice(0, 5);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* sin almacenamiento */ }
  listeners.forEach((l) => l());
}

export function useTracking(): Tracked[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => cache, () => cache);
}

type Mode = 'delivery' | 'recojo' | 'mesa';
const STEPS: Record<Mode, string[]> = {
  delivery: ['Confirmado', 'En preparación', 'En despacho', 'En camino', 'Entregado'],
  recojo: ['Confirmado', 'En preparación', 'Listo para recoger', 'Entregado'],
  mesa: ['Confirmado', 'En preparación', 'Listo, va a tu mesa', 'Entregado'],
};

/** Paso actual: -1 = todavía validando el pago. */
function stepOf(s: RequestStatus, mode: Mode): number {
  if (s.status !== 'aceptado') return -1;
  const last = STEPS[mode].length - 1;
  if (s.delivery === 'entregado' || (mode !== 'delivery' && (s.closed || s.served))) return last;
  if (mode === 'delivery' && (s.delivery === 'en_camino' || s.delivery === 'llego')) return 3;
  if (s.kitchen === 'listo') return 2;
  if (s.kitchen === 'recibido' || s.kitchen === 'preparando') return 1;
  return 0;
}

export function OrderTracker({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDb();
  const [s, setS] = useState<RequestStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await fetchRequestStatus(id);
      if (!alive) return;
      setS(r);
      setLoaded(true);
    };
    void load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);

  const mode = ((s?.mode as Mode) ?? 'delivery') in STEPS ? (s?.mode as Mode) ?? 'delivery' : 'delivery';
  const steps = STEPS[mode];
  const step = s ? stepOf(s, mode) : -1;

  return (
    <Modal title={s?.number ? `Tu pedido #${s.number}` : 'Tu pedido'} onClose={onClose} footer={<button className="btn primary block" onClick={onClose}>Volver a la carta</button>}>
      {!loaded && <p className="muted">Consultando…</p>}
      {loaded && !s && <p className="muted">No encontramos este pedido. Escríbenos al WhatsApp {db.settings.whatsapp}.</p>}
      {s?.status === 'rechazado' && (
        <div className="track-rejected" role="status">
          <b>No pudimos atender tu pedido.</b>
          {s.reason && <p>{s.reason}</p>}
          <p className="muted small">Escríbenos al WhatsApp {db.settings.whatsapp} si deseas cambiar algo.</p>
        </div>
      )}
      {s && s.status !== 'rechazado' && (
        <>
          {s.cancelled
            ? <p className="err-text">Este pedido fue anulado. Escríbenos al WhatsApp {db.settings.whatsapp}.</p>
            : step < 0 && (
              <div className="track-pending" role="status">
                <b>Recibimos tu pedido</b>
                <p className="small">Estamos validando tu pago. Si pagaste con Yape, Plin o en línea, envía la captura al WhatsApp <b>{db.settings.whatsapp}</b>.</p>
              </div>
            )}
          <ol className="track-steps" aria-label="Estado del pedido">
            {steps.map((label, i) => (
              <li key={label} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
                <span className="dot" aria-hidden>{i < step || (i === step && i === steps.length - 1) ? '✓' : i + 1}</span>
                <span>{label}{i === 3 && mode === 'delivery' && step === 3 && s.driver ? ` · ${s.driver}` : ''}</span>
              </li>
            ))}
          </ol>
          <p className="muted small">Se actualiza solo cada pocos segundos.</p>
        </>
      )}
    </Modal>
  );
}
