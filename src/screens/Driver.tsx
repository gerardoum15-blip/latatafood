import { useEffect, useState } from 'react';
import { assignDriver, orderTotal, setDeliveryStatus, useDb, useSession } from '../data/store';
import { CLOUD, sendMyLocation } from '../data/cloud';
import { DELIVERY_LABEL, KITCHEN_LABEL, PAY_LABEL, type Order } from '../types';
import { money, minutesAgo, time, orderNo } from '../lib/format';
import { fillTemplate, mapsLink, trackUrl, waLink } from '../lib/whatsapp';
import { Empty, ItemLines, useTick } from '../components/ui';
import { TicketButton } from '../components/TicketButton';

type ShareState = 'starting' | 'on' | 'denied' | 'error' | 'unsupported';

const metersBetween = (a: GeolocationCoordinates, b: GeolocationCoordinates) => {
  const R = 6371000, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude), dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Comparte la ubicación del driver mientras tiene la app abierta (y mantiene la pantalla encendida). */
function useShareLocation(): ShareState {
  const [state, setState] = useState<ShareState>('starting');
  useEffect(() => {
    if (!CLOUD) return;
    if (!('geolocation' in navigator)) { setState('unsupported'); return; }
    let lastSent = 0;
    let lastPos: GeolocationCoordinates | null = null;
    let lock: { release?: () => Promise<void> } | null = null;
    const keepAwake = async () => {
      try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* no disponible */ }
    };
    void keepAwake();
    const onVisible = () => { if (document.visibilityState === 'visible') void keepAwake(); };
    document.addEventListener('visibilitychange', onVisible);
    const watch = navigator.geolocation.watchPosition(
      async (p) => {
        setState('on');
        const moved = lastPos ? metersBetween(lastPos, p.coords) : Infinity;
        if (Date.now() - lastSent < 10000 && moved < 25) return;
        lastSent = Date.now();
        lastPos = p.coords;
        if (await sendMyLocation(p.coords)) setState('error');
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    const heartbeat = setInterval(() => { if (lastPos) void sendMyLocation(lastPos); }, 60000);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release?.();
    };
  }, []);
  return state;
}

function ShareBanner({ state }: { state: ShareState }) {
  if (!CLOUD) return null;
  if (state === 'on') return <p className="share-banner on" role="status">📍 Compartiendo tu ubicación en tiempo real. Mantén la app abierta durante el reparto.</p>;
  if (state === 'starting') return <p className="share-banner" role="status">Activando tu ubicación… acepta el permiso si el celular lo pide.</p>;
  if (state === 'denied') return <p className="share-banner off" role="alert">La ubicación está bloqueada. En iPhone: Ajustes → Privacidad → Localización → Safari → "Al usar la app". En Android: toca el candado de la barra de direcciones → Permisos → Ubicación. Luego recarga.</p>;
  return <p className="share-banner off" role="alert">No se pudo compartir tu ubicación. Revisa que el GPS esté encendido y recarga la app.</p>;
}

export function DriverScreen() {
  const db = useDb();
  const user = useSession()!;
  useTick();

  const deliveries = db.orders.filter((o) => o.channel === 'delivery' && !o.cancelled);
  const mine = deliveries.filter((o) => !o.closed && o.driverId === user.id).sort((a, b) => a.createdAt - b.createdAt);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = deliveries.filter((o) => o.closed && o.driverId === user.id && (o.closedAt ?? 0) >= start.getTime());
  const cashToday = today.reduce((s, o) => s + o.payments.filter((p) => p.method === 'efectivo').reduce((a, p) => a + p.amount, 0), 0);

  const share = useShareLocation();
  return (
    <div className="page">
      <ShareBanner state={share} />
      <section className="driver-section">
        <h2>Mis pedidos <span className="count">{mine.length}</span></h2>
        {mine.length === 0 ? <Empty>No tienes pedidos asignados. Te llegarán por turno.</Empty> : (
          <div className="cards">{mine.map((o) => <DriverCard key={o.id} order={o} />)}</div>
        )}
      </section>


      <details className="card">
        <summary>Entregados hoy: {today.length} · efectivo cobrado {money(cashToday)}</summary>
        <ul className="list">
          {today.map((o) => (
            <li key={o.id}><span className="grow">{orderNo(o)} · {o.customer?.name}</span><span className="muted small">{o.closedAt ? time(o.closedAt) : ''}</span><b>{money(orderTotal(o))}</b></li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function DriverCard({ order, available }: { order: Order; available?: boolean }) {
  const db = useDb();
  const user = useSession()!;
  const c = order.customer!;
  const total = orderTotal(order);
  const local = db.locales.find((l) => l.id === order.localId);

  const payText = order.plannedPay === 'efectivo'
    ? `efectivo${order.cashWith ? `, paga con ${money(order.cashWith)}` : ''}`
    : order.plannedPay === 'pagado' ? 'ya pagado' : order.plannedPay ? PAY_LABEL[order.plannedPay] : '';

  // En "En camino" se agrega el enlace de seguimiento, salvo que la plantilla ya lo incluya con {seguimiento}.
  const msg = (tpl: string, track = false) => waLink(c.phone, fillTemplate(track && !tpl.includes('{seguimiento}') ? `${tpl}\nSigue tu pedido aquí: {seguimiento}` : tpl, {
    seguimiento: trackUrl(order.id),
    cliente: c.name.split(' ')[0], numero: String(order.number), negocio: db.settings.businessName,
    driver: user.name.split(' ')[0], total: money(total), pago: payText, local: local?.name ?? '',
  }));

  const st = order.deliveryStatus;

  return (
    <article className="card order-card">
      <div className="row between wrap">
        <b>{orderNo(order)} · {c.name}</b>
        <span className="local-badge small">{local?.name}</span>
      </div>
      <div className="row gap wrap">
        <span className={`status s-${order.kitchenStatus}`}>Cocina: {KITCHEN_LABEL[order.kitchenStatus]}</span>
        {st && st !== 'pendiente' && <span className={`status d-${st}`}>{DELIVERY_LABEL[st]}</span>}
        <span className="muted small">{time(order.createdAt)} · hace {minutesAgo(order.createdAt)} min</span>
      </div>

      <div className="driver-info">
        <div><span className="muted">Dirección</span><b>{c.address || '—'}</b></div>
        <div><span className="muted">Cobrar</span>
          <b>{order.plannedPay === 'pagado' ? 'Ya pagado' : `${money(total)} · ${order.plannedPay ? PAY_LABEL[order.plannedPay] : ''}`}</b>
          {order.cashWith ? <span className="muted">Paga con {money(order.cashWith)} → llevar vuelto {money(order.cashWith - total)}</span> : null}
        </div>
      </div>

      <div className="row gap wrap">
        <a className="btn maps grow" href={mapsLink(c.mapsUrl, c.address)} target="_blank" rel="noreferrer">📍 Ver ubicación</a>
        <a className="btn grow" href={waLink(c.phone)} target="_blank" rel="noreferrer">💬 Chat</a>
        <TicketButton order={order} className="btn grow" />
      </div>

      <details><summary>Ver pedido ({order.items.reduce((s, i) => s + i.qty, 0)} ítems)</summary><ItemLines items={order.items} /></details>

      {available ? (
        <button className="btn primary block" onClick={() => assignDriver(order.id, user.id, user)}>Tomar este pedido</button>
      ) : (
        <div className="driver-actions">
          <a className={st === 'pendiente' ? 'btn wa big' : 'btn wa big done'} href={msg(db.settings.msgEnCamino, true)} target="_blank" rel="noreferrer"
            onClick={() => { if (st === 'pendiente') setDeliveryStatus(order.id, 'en_camino', user); }}>
            🛵 Ya tengo tu pedido, estoy en camino{st !== 'pendiente' ? ' ✓' : ''}
          </a>
          <a className={st === 'llego' ? 'btn wa big done' : 'btn wa big'} href={msg(db.settings.msgLlegue)} target="_blank" rel="noreferrer"
            onClick={() => { if (st !== 'llego') setDeliveryStatus(order.id, 'llego', user); }}>
            📍 Ya llegué a tu ubicación{st === 'llego' ? ' ✓' : ''}
          </a>
          {(st === 'en_camino' || st === 'llego') && (
            <button className="btn ok big-ok block" onClick={() => setDeliveryStatus(order.id, 'entregado', user)}>✅ Pedido entregado</button>
          )}
          <p className="muted small">Cada botón abre WhatsApp con el mensaje listo para el cliente.</p>
        </div>
      )}
    </article>
  );
}
