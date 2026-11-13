import { useEffect, useState, useSyncExternalStore, useRef } from 'react';
import { trackOrder, type RequestStatus } from '../data/cloud';
import { LiveMap } from '../components/LazyMaps';
import logo from '../assets/logo.webp';
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

type Tracked2 = RequestStatus & { location: { lat: number; lng: number; updated_at: string } | null };

export function OrderTracker({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Modal title="Tu pedido" onClose={onClose} footer={<button className="btn primary block" onClick={onClose}>Volver a la carta</button>}>
      <TrackerBody id={id} />
    </Modal>
  );
}

/** Página propia del enlace de seguimiento (…#seguir-CODIGO). */
export function TrackingPage({ id }: { id: string }) {
  return (
    <div className="landing">
      <main className="landing-main track-page">
        <img className="landing-logo small" src={logo} alt="La Tata Food" width={640} height={453} />
        <h1>Tu pedido</h1>
        <TrackerBody id={id} />
        <a className="btn landing-cta" href="#carta">🍗 Ver la carta</a>
      </main>
    </div>
  );
}

function TrackerBody({ id }: { id: string }) {
  const db = useDb();
  const [s, setS] = useState<Tracked2 | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await trackOrder(id);
      if (!alive) return;
      setS(r);
      setLoaded(true);
    };
    void load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);

  const mode = ((s?.mode as Mode) ?? 'delivery') in STEPS ? (s?.mode as Mode) ?? 'delivery' : 'delivery';
  const steps = STEPS[mode];
  const step = s ? stepOf(s, mode) : -1;
  const [news, setNews] = useState('');
  const prevStep = useRef<number | null>(null);
  // Al cambiar de estado: vibra, suena y cambia el título de la pestaña para que el cliente esté atento.
  useEffect(() => {
    if (!s || s.status === 'rechazado') return;
    const label = s.cancelled ? 'Pedido anulado' : step >= 0 ? steps[step] : '';
    if (prevStep.current !== null && step !== prevStep.current && label) {
      setNews(label);
      alertCustomer(label);
    }
    prevStep.current = step;
  }, [s, step, steps]);

  return (
    <div className="tracker">
      {s?.number ? <p className="track-number">Pedido <b>#{s.number}</b></p> : null}
      {news && <div className="track-news" role="alert">🔔 Tu pedido cambió: <b>{news}</b></div>}
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
          {s.location && mode === 'delivery' && step === 3 && (
            <div className="track-map">
              <p className="small"><b>{s.driver ?? 'Tu motorizado'}</b> está en camino · ubicación de hace {Math.max(0, Math.round((Date.now() - new Date(s.location.updated_at).getTime()) / 60000))} min</p>
              <LiveMap points={[{ id: 'driver', lat: s.location.lat, lng: s.location.lng, label: (s.driver ?? 'Motorizado').split(' ')[0], kind: 'driver' }]} height={240} />
            </div>
          )}
          <p className="muted small">Se actualiza solo cada pocos segundos. Deja esta página abierta: te avisaremos con sonido y vibración cuando cambie el estado. También te escribiremos por WhatsApp.</p>
        </>
      )}
    </div>
  );
}

/** Aviso al cliente: vibración, un "ding" y título de la pestaña. */
function alertCustomer(label: string) {
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* no disponible */ }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.2, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.6);
      setTimeout(() => void ctx.close(), 1000);
    }
  } catch { /* sin sonido */ }
  if (document.hidden) {
    const old = document.title;
    document.title = `🔔 ${label}`;
    const back = () => { if (!document.hidden) { document.title = old; document.removeEventListener('visibilitychange', back); } };
    document.addEventListener('visibilitychange', back);
  }
}
