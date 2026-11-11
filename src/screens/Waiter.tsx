import { useState } from 'react';
import { addItems, cancelOrder, createOrder, markServed, orderTotal, payOrder, useDb, useSession } from '../data/store';
import { KITCHEN_LABEL, type Order, type OrderItem } from '../types';
import { money, minutesAgo, time } from '../lib/format';
import { OrderBuilder } from '../components/OrderBuilder';
import { LocalPicker, PaymentModal, useWorkLocal } from '../components/shared';
import { ConfirmButton, ItemLines, Timeline, useTick } from '../components/ui';

type View = { kind: 'tables' } | { kind: 'new'; table: number } | { kind: 'order'; id: string } | { kind: 'add'; id: string };

export function WaiterScreen() {
  const db = useDb();
  const user = useSession()!;
  const [localId, setLocalId] = useWorkLocal(user.role === 'mozo' ? user.localId : null);
  const [view, setView] = useState<View>({ kind: 'tables' });
  useTick();

  const local = db.locales.find((l) => l.id === localId);
  const open = db.orders.filter((o) => o.localId === localId && o.channel === 'salon' && !o.closed);

  if (view.kind === 'new' || view.kind === 'add') {
    const order = view.kind === 'add' ? db.orders.find((o) => o.id === view.id) : undefined;
    return (
      <NewItems
        title={view.kind === 'new' ? `Mesa ${view.table} · nuevo pedido` : `Mesa ${order?.table} · agregar ítems`}
        localId={localId}
        onCancel={() => setView(view.kind === 'add' ? { kind: 'order', id: view.id } : { kind: 'tables' })}
        onSend={(items, note) => {
          if (view.kind === 'new') {
            const id = createOrder({ localId, channel: 'salon', table: view.table, customer: null, deliveryFee: 0, plannedPay: null, cashWith: null, driverId: null, items, note }, user);
            setView({ kind: 'order', id });
          } else {
            addItems(view.id, items, user);
            setView({ kind: 'order', id: view.id });
          }
        }}
      />
    );
  }

  if (view.kind === 'order') {
    const order = db.orders.find((o) => o.id === view.id);
    if (!order) return null;
    return <OrderDetail order={order} onBack={() => setView({ kind: 'tables' })} onAdd={() => setView({ kind: 'add', id: order.id })} />;
  }

  return (
    <div className="page">
      <div className="section-head">
        <h2>Mesas</h2>
        <LocalPicker value={localId} onChange={setLocalId} fixed={user.role === 'mozo' && !!user.localId} />
      </div>
      <p className="muted">Los pedidos se envían a la cocina de <b>{local?.name}</b>.</p>
      <div className="table-grid">
        {Array.from({ length: local?.tables ?? 0 }, (_, i) => i + 1).map((n) => {
          const o = open.find((x) => x.table === n);
          const cls = !o ? 'table-card free' : o.kitchenStatus === 'listo' && !o.served ? 'table-card ready' : o.served ? 'table-card served' : 'table-card busy';
          return (
            <button key={n} className={cls} onClick={() => setView(o ? { kind: 'order', id: o.id } : { kind: 'new', table: n })}>
              <span className="tc-num">Mesa {n}</span>
              {o ? (
                <>
                  <span className="tc-status">{o.served ? 'Servido' : KITCHEN_LABEL[o.kitchenStatus]}</span>
                  <span className="tc-total">{money(orderTotal(o))}</span>
                  <span className="tc-time">{minutesAgo(o.createdAt)} min</span>
                </>
              ) : <span className="tc-status">Libre</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NewItems({ title, localId, onCancel, onSend, extra, sendLabel = 'Enviar a cocina', canSend = true }: {
  title: string; localId: string; onCancel: () => void; onSend: (items: OrderItem[], note: string) => void;
  extra?: React.ReactNode; sendLabel?: string; canSend?: boolean;
}) {
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [note, setNote] = useState('');
  const total = cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  return (
    <div className="page">
      <div className="section-head">
        <button className="btn ghost small" onClick={onCancel}>← Volver</button>
        <h2>{title}</h2>
      </div>
      {extra}
      <OrderBuilder localId={localId} cart={cart} setCart={setCart} />
      <label className="field">
        <span>Nota general del pedido</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
      </label>
      <div className="sticky-bar">
        <span className="grow"><b>{money(total)}</b> · {cart.reduce((s, i) => s + i.qty, 0)} ítems</span>
        <button className="btn primary" disabled={cart.length === 0 || !canSend} onClick={() => onSend(cart, note.trim())}>{sendLabel}</button>
      </div>
    </div>
  );
}

function OrderDetail({ order, onBack, onAdd }: { order: Order; onBack: () => void; onAdd: () => void }) {
  const user = useSession()!;
  const db = useDb();
  const [paying, setPaying] = useState(false);
  const total = orderTotal(order);
  const lastRound = Math.max(...order.items.map((i) => i.round));
  const local = db.locales.find((l) => l.id === order.localId);

  return (
    <div className="page">
      <div className="section-head">
        <button className="btn ghost small" onClick={onBack}>← Mesas</button>
        <h2>Mesa {order.table} · #{order.number}</h2>
      </div>
      <div className="card">
        <div className="row between wrap">
          <span className="muted">{local?.name} · abierto {time(order.createdAt)} por {order.createdByName}</span>
          <span className={`status s-${order.served ? 'servido' : order.kitchenStatus}`}>{order.served ? 'Servido' : KITCHEN_LABEL[order.kitchenStatus]}</span>
        </div>
        <ItemLines items={order.items} highlightRound={lastRound} />
        {order.note && <p className="item-note">📝 {order.note}</p>}
        <div className="total-row"><span>Total</span><b>{money(total)}</b></div>
      </div>
      {!order.closed && (
        <div className="action-row">
          <button className="btn" onClick={onAdd}>+ Agregar ítems</button>
          {!order.served && order.kitchenStatus === 'listo' && <button className="btn ok" onClick={() => markServed(order.id, user)}>Marcar servido</button>}
          <button className="btn primary" onClick={() => setPaying(true)}>Cobrar {money(total)}</button>
          {user.role === 'admin' && (
            <ConfirmButton label="Anular" title={`Anular mesa ${order.table}`} message="El pedido no contará en las ventas." reason confirmLabel="Anular pedido" onConfirm={(r) => { cancelOrder(order.id, r, user); onBack(); }} />
          )}
        </div>
      )}
      <details className="card">
        <summary>Historial del pedido</summary>
        <Timeline order={order} />
      </details>
      {paying && (
        <PaymentModal total={total} onClose={() => setPaying(false)} onConfirm={(p) => { payOrder(order.id, p, user); setPaying(false); onBack(); }} />
      )}
    </div>
  );
}

