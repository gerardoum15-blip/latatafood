import { useState } from 'react';
import { assignDriver, cancelOrder, createOrder, orderTotal, useDb, useSession } from '../data/store';
import { DELIVERY_LABEL, KITCHEN_LABEL, PAY_LABEL, type Customer, type Order, type PayMethod } from '../types';
import { money, minutesAgo, time } from '../lib/format';
import { mapsLink, waLink } from '../lib/whatsapp';
import { LocalPicker, useWorkLocal } from '../components/shared';
import { ConfirmButton, Empty, ItemLines, Tabs, Timeline, useTick } from '../components/ui';
import { NewItems } from './Waiter';

const EMPTY: Customer = { name: '', phone: '', address: '', reference: '', mapsUrl: '' };
const PLANNED: PayMethod[] = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'pagado'];

export function DeliveryScreen() {
  const db = useDb();
  const user = useSession()!;
  const [localId, setLocalId] = useWorkLocal(user.role === 'delivery' ? user.localId : null);
  const [tab, setTab] = useState<'curso' | 'hoy'>('curso');
  const [creating, setCreating] = useState(false);
  const [customer, setCustomer] = useState<Customer>(EMPTY);
  const [fee, setFee] = useState('3');
  const [pay, setPay] = useState<PayMethod>('efectivo');
  const [cashWith, setCashWith] = useState('');
  const [driverId, setDriverId] = useState('');
  useTick();

  const drivers = db.users.filter((u) => u.role === 'driver' && u.active);
  const mine = db.orders.filter((o) => o.channel === 'delivery' && o.localId === localId);
  const active = mine.filter((o) => !o.closed).sort((a, b) => a.createdAt - b.createdAt);
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const done = mine.filter((o) => o.closed && (o.closedAt ?? 0) >= startToday.getTime()).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

  if (creating) {
    const valid = customer.name.trim() && customer.phone.trim() && (customer.address.trim() || customer.mapsUrl.trim());
    return (
      <NewItems
        title="Nuevo pedido delivery"
        localId={localId}
        canSend={!!valid}
        sendLabel={valid ? 'Enviar a cocina' : 'Completa los datos del cliente'}
        onCancel={() => setCreating(false)}
        extra={
          <div className="card form-grid">
            <div className="full"><LocalPicker value={localId} onChange={setLocalId} fixed={user.role === 'delivery' && !!user.localId} /></div>
            <label className="field"><span>Cliente *</span><input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
            <label className="field"><span>WhatsApp / celular *</span><input type="tel" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="987654321" /></label>
            <label className="field full"><span>Dirección *</span><input value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} /></label>
            <label className="field"><span>Referencia</span><input value={customer.reference} onChange={(e) => setCustomer({ ...customer, reference: e.target.value })} /></label>
            <label className="field"><span>Enlace de Google Maps</span><input value={customer.mapsUrl} onChange={(e) => setCustomer({ ...customer, mapsUrl: e.target.value })} placeholder="Pega la ubicación que envió el cliente" /></label>
            <label className="field"><span>Costo de envío (S/)</span><input type="number" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
            <label className="field"><span>Forma de pago</span>
              <select value={pay} onChange={(e) => setPay(e.target.value as PayMethod)}>
                {PLANNED.map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
              </select>
            </label>
            {pay === 'efectivo' && <label className="field"><span>Paga con (S/)</span><input type="number" inputMode="decimal" value={cashWith} onChange={(e) => setCashWith(e.target.value)} placeholder="Para llevar vuelto" /></label>}
            <label className="field"><span>Driver</span>
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Asignar después</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>
        }
        onSend={(items, note) => {
          createOrder({
            localId, channel: 'delivery', table: null, customer: { ...customer, name: customer.name.trim(), phone: customer.phone.trim() },
            deliveryFee: Number(fee) || 0, plannedPay: pay, cashWith: pay === 'efectivo' && cashWith ? Number(cashWith) : null,
            driverId: driverId || null, items, note,
          }, user);
          setCustomer(EMPTY); setCashWith(''); setDriverId(''); setCreating(false); setTab('curso');
        }}
      />
    );
  }

  return (
    <div className="page">
      <div className="section-head">
        <h2>Delivery</h2>
        <LocalPicker value={localId} onChange={setLocalId} fixed={user.role === 'delivery' && !!user.localId} />
      </div>
      <button className="btn primary block" onClick={() => setCreating(true)}>+ Nuevo pedido delivery</button>
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'curso', label: `En curso (${active.length})` },
        { value: 'hoy', label: `Entregados hoy (${done.length})` },
      ]} />
      {(tab === 'hoy' ? done : active).length === 0 && <Empty>No hay pedidos.</Empty>}
      <div className="cards">
        {(tab === 'hoy' ? done : active).map((o) => <DeliveryCard key={o.id} order={o} />)}
      </div>
    </div>
  );
}

function DeliveryCard({ order }: { order: Order }) {
  const db = useDb();
  const user = useSession()!;
  const drivers = db.users.filter((u) => u.role === 'driver' && u.active);
  const c = order.customer!;
  return (
    <article className="card order-card">
      <div className="row between wrap">
        <b>#{order.number} · {c.name}</b>
        <span className="muted">{time(order.createdAt)} · {minutesAgo(order.createdAt)} min</span>
      </div>
      <div className="row gap wrap">
        <span className={`status s-${order.kitchenStatus}`}>Cocina: {KITCHEN_LABEL[order.kitchenStatus]}</span>
        {order.deliveryStatus && <span className={`status d-${order.deliveryStatus}`}>{DELIVERY_LABEL[order.deliveryStatus]}</span>}
        {order.cancelled && <span className="status s-anulado">Anulado</span>}
      </div>
      <p className="muted small">{c.address}{c.reference ? ` · Ref: ${c.reference}` : ''}</p>
      <ItemLines items={order.items} />
      <div className="total-row"><span>Total (envío {money(order.deliveryFee)}) · {order.plannedPay ? PAY_LABEL[order.plannedPay] : ''}</span><b>{money(orderTotal(order))}</b></div>
      {!order.closed && (
        <div className="row gap wrap">
          <select value={order.driverId ?? ''} onChange={(e) => assignDriver(order.id, e.target.value || null, user)} aria-label="Driver">
            <option value="">Sin driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <a className="btn small wa" href={waLink(c.phone)} target="_blank" rel="noreferrer">WhatsApp</a>
          <a className="btn small" href={mapsLink(c.mapsUrl, c.address)} target="_blank" rel="noreferrer">Mapa</a>
          {user.role === 'admin' && (
            <ConfirmButton className="btn small ghost danger" label="Anular" title={`Anular pedido #${order.number}`} message="El pedido no contará en las ventas." reason confirmLabel="Anular pedido" onConfirm={(r) => cancelOrder(order.id, r, user)} />
          )}
        </div>
      )}
      <details><summary>Historial</summary><Timeline order={order} /></details>
    </article>
  );
}
