import { useState } from 'react';
import { addItems, cancelOrder, createOrder, discountTotal, lineTotal, markServed, orderTotal, payOrder, setOrderDiscount, useDb, useSession } from '../data/store';
import { KITCHEN_LABEL, type Discount, type Order, type OrderItem } from '../types';
import { money, minutesAgo, time, orderNo } from '../lib/format';
import { buildCreamItem, OrderBuilder, type CreamPicks } from '../components/OrderBuilder';
import { suggestPackaging } from '../lib/rules';
import { DiscountModal } from '../components/DiscountModal';
import { TicketButton } from '../components/TicketButton';
import { LocalPicker, PaymentModal, useWorkLocal } from '../components/shared';
import { ConfirmButton, ItemLines, Timeline, useTick } from '../components/ui';

type View = { kind: 'tables' } | { kind: 'new'; table: number } | { kind: 'order'; id: string } | { kind: 'add'; id: string };

export function WaiterScreen() {
  return <NeedsLocal><WaiterScreenInner /></NeedsLocal>;
}

/** Cocina y mozo de mesa trabajan solo en su local: sin local asignado no pueden entrar. */
function NeedsLocal({ children }: { children: import('react').ReactNode }) {
  const user = useSession()!;
  if (user.role !== 'admin' && !user.localId) {
    return <div className="page"><div className="empty">Tu usuario no tiene un local asignado. Pide al administrador que te lo asigne en <b>Usuarios</b>.</div></div>;
  }
  return <>{children}</>;
}

function WaiterScreenInner() {
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
        onSend={(items, note, _pkg, discount) => {
          if (view.kind === 'new') {
            const id = createOrder({ localId, channel: 'salon', table: view.table, customer: null, deliveryFee: 0, plannedPay: null, cashWith: null, driverId: null, items, note, discount }, user);
            setView({ kind: 'order', id });
          } else {
            addItems(view.id, items, user);
            if (discount) {
              // Se suma al descuento que ya tenía la mesa.
              const prev = order?.discount;
              setOrderDiscount(view.id, prev ? { amount: prev.amount + discount.amount, reason: `${prev.reason} + ${discount.reason}` } : discount, user);
            }
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

export interface InitialOrder { cart: OrderItem[]; picks: CreamPicks; pkgAmount: number | null; note: string; discount?: Discount }
export interface Packaging { qty: number; amount: number }

export interface Draft { items: OrderItem[]; note: string; pkg: Packaging; discount: number; subtotal: number }

export function NewItems({ title, localId, onCancel, onSend, extra, sendLabel = 'Enviar a cocina', canSend = true, packaging, initial, beforeSend }: {
  title: string; localId: string; onCancel?: () => void; onSend: (items: OrderItem[], note: string, packaging: Packaging, discount?: Discount) => void;
  extra?: import('react').ReactNode; sendLabel?: string; canSend?: boolean; packaging?: boolean; initial?: InitialOrder;
  /** Paso previo a cocina (ej. confirmar con el cliente), con el pedido tal como está. */
  beforeSend?: (d: Draft) => import('react').ReactNode;
}) {
  const db = useDb();
  const [cart, setCart] = useState<OrderItem[]>(initial?.cart ?? []);
  const [picks, setPicks] = useState<CreamPicks>(initial?.picks ?? {});
  const creamItem = buildCreamItem(db, cart, picks);
  const items = creamItem ? [...cart, creamItem] : cart;
  const [note, setNote] = useState(initial?.note ?? '');
  const [pkgManual, setPkgManual] = useState<number | null>(initial?.pkgAmount ?? null);
  const suggested = suggestPackaging(cart, db);
  const pkgAmount = packaging ? pkgManual ?? suggested.amount : 0;
  const pkg: Packaging = { qty: packaging ? suggested.qty : 0, amount: pkgAmount };
  const [discount, setDiscount] = useState<Discount | undefined>(initial?.discount);
  const [discOpen, setDiscOpen] = useState(false);
  const beforeDiscount = items.reduce((s, i) => s + lineTotal(i), 0) + pkgAmount;
  const discAmount = discount ? Math.min(discount.amount, beforeDiscount) : 0;
  const total = beforeDiscount - discAmount;
  return (
    <div className="page">
      <div className="section-head">
        {onCancel && <button className="btn ghost small" onClick={onCancel}>← Volver</button>}
        <h2>{title}</h2>
      </div>
      {extra}
      <OrderBuilder localId={localId} cart={cart} setCart={setCart} picks={picks} setPicks={setPicks} />
      {packaging && (
        <div className="card packaging">
          <div className="grow">
            <b>Costo de empaques</b>
            <div className="muted small">{suggested.qty} {suggested.qty === 1 ? 'táper' : 'táperes'} según el precio de cada plato · sugerido {money(suggested.amount)}</div>
          </div>
          <div className="stepper small">
            <button onClick={() => setPkgManual(Math.max(0, Math.round((pkgAmount - 0.5) * 100) / 100))} aria-label="Bajar S/ 0.50">−</button>
            <b className="pkg-amount">{money(pkgAmount)}</b>
            <button onClick={() => setPkgManual(Math.round((pkgAmount + 0.5) * 100) / 100)} aria-label="Subir S/ 0.50">+</button>
          </div>
          {pkgManual !== null && pkgManual !== suggested.amount && <button className="link small" onClick={() => setPkgManual(null)}>Usar sugerido ({money(suggested.amount)})</button>}
        </div>
      )}
      {cart.length > 0 && (
        <div className="card packaging">
          <div className="grow">
            <b>Descuento al pedido</b>
            <div className="muted small">{discount ? `−${money(discAmount)}${discount.percent ? ` (${discount.percent}%)` : ''} · ${discount.reason}` : 'Opcional: en S/ o en %'}</div>
          </div>
          <button className="btn small" onClick={() => setDiscOpen(true)}>{discount ? 'Cambiar' : '% Agregar descuento'}</button>
        </div>
      )}
      {discOpen && (
        <DiscountModal title="Descuento al pedido" base={beforeDiscount} initial={discount} onApply={setDiscount} onRemove={() => setDiscount(undefined)} onClose={() => setDiscOpen(false)} />
      )}
      <label className="field">
        <span>Nota general del pedido</span>
        <input id="order-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
      </label>
      {beforeSend && cart.length > 0 && beforeSend({ items, note: note.trim(), pkg, discount: discAmount, subtotal: total })}
      <div className="sticky-bar">
        <span className="grow">Cuenta: <b>{money(total)}</b> · {cart.reduce((s, i) => s + i.qty, 0)} ítems</span>
        <button className="btn primary" disabled={cart.length === 0 || !canSend} onClick={() => onSend(items, note.trim(), pkg, discount ? { ...discount, amount: discAmount } : undefined)}>{sendLabel}</button>
      </div>
    </div>
  );
}

function OrderDetail({ order, onBack, onAdd }: { order: Order; onBack: () => void; onAdd: () => void }) {
  const user = useSession()!;
  const db = useDb();
  const [paying, setPaying] = useState(false);
  const total = orderTotal(order);
  const [discOpen, setDiscOpen] = useState(false);
  const discBase = order.items.reduce((acc, it) => acc + lineTotal(it), 0);
  const lastRound = Math.max(...order.items.map((i) => i.round));
  const local = db.locales.find((l) => l.id === order.localId);

  return (
    <div className="page">
      <div className="section-head">
        <button className="btn ghost small" onClick={onBack}>← Mesas</button>
        <h2>Mesa {order.table} · {orderNo(order)}</h2>
      </div>
      <div className="card">
        <div className="row between wrap">
          <span className="muted">{local?.name} · abierto {time(order.createdAt)} por {order.createdByName}</span>
          <span className={`status s-${order.served ? 'servido' : order.kitchenStatus}`}>{order.served ? 'Servido' : KITCHEN_LABEL[order.kitchenStatus]}</span>
        </div>
        <ItemLines items={order.items} highlightRound={lastRound} />
        {order.note && <p className="item-note">📝 {order.note}</p>}
        {order.discount && <div className="total-row discount-row"><span>Descuento al pedido{order.discount.percent ? ` (${order.discount.percent}%)` : ''} · {order.discount.reason}</span><b>−{money(order.discount.amount)}</b></div>}
        {discountTotal(order) > 0 && <p className="muted small">Ahorro total del cliente: {money(discountTotal(order))}</p>}
        <div className="total-row"><span>Total</span><b>{money(total)}</b></div>
      </div>
      {!order.closed && (
        <div className="action-row">
          <button className="btn" onClick={onAdd}>+ Agregar ítems</button>
          {!order.served && order.kitchenStatus === 'listo' && <button className="btn ok" onClick={() => markServed(order.id, user)}>Marcar servido</button>}
          <button className="btn" onClick={() => setDiscOpen(true)}>{order.discount ? `Descuento −${money(order.discount.amount)}` : '% Descuento'}</button>
          <button className="btn primary" onClick={() => setPaying(true)}>Cobrar {money(total)}</button>
          <TicketButton order={order} className="btn" label="🧾 Ticket" />
          {user.role === 'admin' && (
            <ConfirmButton label="Anular" title={`Anular mesa ${order.table}`} message="El pedido no contará en las ventas." reason confirmLabel="Anular pedido" onConfirm={(r) => { cancelOrder(order.id, r, user); onBack(); }} />
          )}
        </div>
      )}
      <details className="card">
        <summary>Historial del pedido</summary>
        <Timeline order={order} />
      </details>
      {discOpen && (
        <DiscountModal title={`Descuento · Mesa ${order.table}`} base={discBase} initial={order.discount}
          onApply={(d) => setOrderDiscount(order.id, d, user)} onRemove={() => setOrderDiscount(order.id, null, user)} onClose={() => setDiscOpen(false)} />
      )}
      {paying && (
        <PaymentModal total={total} onClose={() => setPaying(false)} onConfirm={(p) => { payOrder(order.id, p, user); setPaying(false); onBack(); }} />
      )}
    </div>
  );
}

