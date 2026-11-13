import { useEffect, useRef } from 'react';
import { setKitchenStatus, useDb, useSession } from '../data/store';
import type { KitchenStatus, Order } from '../types';
import { minutesAgo, time, orderNo } from '../lib/format';
import { LocalPicker, useWorkLocal } from '../components/shared';
import { Empty, ItemLines, useTick } from '../components/ui';

const NEXT: Record<KitchenStatus, { to: KitchenStatus; label: string } | null> = {
  enviado: { to: 'preparando', label: 'Recibido · En preparación' },
  recibido: { to: 'listo', label: '¡Listo!' },
  preparando: { to: 'listo', label: '¡Listo!' },
  listo: null,
};

export function beep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    [0, 0.25].forEach((delay) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.2);
      o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.2);
    });
  } catch { /* sin audio */ }
}

export function KitchenScreen() {
  return <NeedsLocal><KitchenScreenInner /></NeedsLocal>;
}

/** Cocina y mozo de mesa trabajan solo en su local: sin local asignado no pueden entrar. */
function NeedsLocal({ children }: { children: import('react').ReactNode }) {
  const user = useSession()!;
  if (user.role !== 'admin' && !user.localId) {
    return <div className="page"><div className="empty">Tu usuario no tiene un local asignado. Pide al administrador que te lo asigne en <b>Usuarios</b>.</div></div>;
  }
  return <>{children}</>;
}

function KitchenScreenInner() {
  const db = useDb();
  const user = useSession()!;
  const [localId, setLocalId] = useWorkLocal(user.role === 'cocina' ? user.localId : null);
  useTick(20000);

  const cutoff = Date.now() - 30 * 60000;
  const orders = db.orders
    .filter((o) => o.localId === localId && !o.cancelled && (o.kitchenStatus !== 'listo' || ((o.readyAt ?? 0) > cutoff && !o.closed)))
    .sort((a, b) => a.sentAt - b.sentAt);

  const pendingCount = orders.filter((o) => o.kitchenStatus === 'enviado').length;
  const prev = useRef(pendingCount);
  useEffect(() => {
    if (pendingCount > prev.current) beep();
    prev.current = pendingCount;
  }, [pendingCount]);

  const cols: { key: KitchenStatus; title: string }[] = [
    { key: 'enviado', title: 'Nuevos' },
    { key: 'preparando', title: 'En preparación' },
    { key: 'listo', title: 'Listos' },
  ];

  return (
    <div className="page wide">
      <div className="section-head">
        <h2>Cocina</h2>
        <LocalPicker value={localId} onChange={setLocalId} fixed={user.role === 'cocina' && !!user.localId} />
      </div>
      {orders.length === 0 && <Empty>Sin pedidos pendientes 👌</Empty>}
      <div className="kanban">
        {cols.map((c) => {
          const list = orders.filter((o) => (o.kitchenStatus === 'recibido' ? 'preparando' : o.kitchenStatus) === c.key);
          return (
            <section key={c.key} className={`kcol k-${c.key}`}>
              <h3>{c.title} <span className="count">{list.length}</span></h3>
              {list.map((o) => <KitchenTicket key={o.id} order={o} />)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function KitchenTicket({ order }: { order: Order }) {
  const user = useSession()!;
  const db = useDb();
  const next = NEXT[order.kitchenStatus];
  const lastRound = Math.max(...order.items.map((i) => i.round));
  const items = order.kitchenStatus === 'listo' ? order.items : order.items.filter((i) => i.round === lastRound);
  const wait = minutesAgo(order.sentAt);
  const driver = db.users.find((u) => u.id === order.driverId);
  return (
    <article className={`kticket ${wait >= 20 && order.kitchenStatus !== 'listo' ? 'late' : ''}`}>
      <header>
        <b>{order.channel === 'salon' ? `🍽 Mesa ${order.table}` : `🛵 Delivery`}</b>
        <span>{orderNo(order)}</span>
      </header>
      <div className="muted small">
        {time(order.sentAt)} · hace {wait} min · {order.createdByName}
        {order.channel === 'delivery' && ` · ${order.customer?.name}${driver ? ` · ${driver.name}` : ''}`}
      </div>
      {lastRound > 1 && order.kitchenStatus !== 'listo' && <div className="round-tag">Ronda {lastRound} (agregado)</div>}
      <ItemLines items={items} big showPrices={false} />
      {order.note && <div className="item-note">📝 {order.note}</div>}
      {next && <button className={`btn block k-btn-${next.to}`} onClick={() => setKitchenStatus(order.id, next.to, user)}>{next.label}</button>}
    </article>
  );
}
