import { useState } from 'react';
import { assignDriver, orderTotal, setDeliveryStatus, useDb, useSession } from '../data/store';
import { DELIVERY_LABEL, KITCHEN_LABEL, PAY_LABEL, type DeliveryStatus, type Order } from '../types';
import { money, minutesAgo, time } from '../lib/format';
import { fillTemplate, mapsLink, waLink } from '../lib/whatsapp';
import { Empty, ItemLines, Tabs, useTick } from '../components/ui';

const STEPS: { to: DeliveryStatus; label: string; msg: 'msgRecogido' | 'msgEnCamino' | 'msgEntregado' }[] = [
  { to: 'recogido', label: 'Recogido', msg: 'msgRecogido' },
  { to: 'en_camino', label: 'En camino', msg: 'msgEnCamino' },
  { to: 'entregado', label: 'Entregado', msg: 'msgEntregado' },
];

export function DriverScreen() {
  const db = useDb();
  const user = useSession()!;
  const [tab, setTab] = useState<'mios' | 'libres' | 'hoy'>('mios');
  useTick();

  const deliveries = db.orders.filter((o) => o.channel === 'delivery' && !o.cancelled);
  const mine = deliveries.filter((o) => !o.closed && o.driverId === user.id).sort((a, b) => a.createdAt - b.createdAt);
  const free = deliveries.filter((o) => !o.closed && !o.driverId).sort((a, b) => a.createdAt - b.createdAt);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = deliveries.filter((o) => o.closed && o.driverId === user.id && (o.closedAt ?? 0) >= start.getTime());
  const cashToday = today.reduce((s, o) => s + o.payments.filter((p) => p.method === 'efectivo').reduce((a, p) => a + p.amount, 0), 0);
  const list = tab === 'mios' ? mine : tab === 'libres' ? free : today;

  return (
    <div className="page">
      <div className="section-head"><h2>Mis entregas</h2></div>
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'mios', label: `Míos (${mine.length})` },
        { value: 'libres', label: `Sin driver (${free.length})` },
        { value: 'hoy', label: `Hoy (${today.length})` },
      ]} />
      {tab === 'hoy' && today.length > 0 && (
        <div className="card row between"><span>Efectivo cobrado hoy</span><b>{money(cashToday)}</b></div>
      )}
      {list.length === 0 && <Empty>{tab === 'mios' ? 'No tienes pedidos asignados.' : 'No hay pedidos.'}</Empty>}
      <div className="cards">
        {list.map((o) => <DriverCard key={o.id} order={o} free={tab === 'libres'} />)}
      </div>
    </div>
  );
}

function DriverCard({ order, free }: { order: Order; free: boolean }) {
  const db = useDb();
  const user = useSession()!;
  const c = order.customer!;
  const total = orderTotal(order);
  const local = db.locales.find((l) => l.id === order.localId);
  const doneIdx = STEPS.findIndex((s) => s.to === order.deliveryStatus);

  const payText = order.plannedPay === 'efectivo'
    ? `efectivo${order.cashWith ? `, paga con ${money(order.cashWith)}` : ''}`
    : order.plannedPay ? PAY_LABEL[order.plannedPay].toLowerCase() : '';

  const stepLink = (step: typeof STEPS[number]) => waLink(c.phone, fillTemplate(db.settings[step.msg], {
    cliente: c.name.split(' ')[0], numero: String(order.number), negocio: db.settings.businessName,
    driver: user.name, total: money(total), pago: payText, local: local?.name ?? '',
  }));

  return (
    <article className="card order-card">
      <div className="row between wrap">
        <b>#{order.number} · {c.name}</b>
        <span className="local-badge small">{local?.name}</span>
      </div>
      <div className="row gap wrap">
        <span className={`status s-${order.kitchenStatus}`}>Cocina: {KITCHEN_LABEL[order.kitchenStatus]}</span>
        {order.deliveryStatus && <span className={`status d-${order.deliveryStatus}`}>{DELIVERY_LABEL[order.deliveryStatus]}</span>}
        <span className="muted small">{time(order.createdAt)} · hace {minutesAgo(order.createdAt)} min</span>
      </div>

      <div className="driver-info">
        <div><span className="muted">Dirección</span><b>{c.address || '—'}</b>{c.reference && <span className="muted"> Ref: {c.reference}</span>}</div>
        <div><span className="muted">Cobrar</span><b>{order.plannedPay === 'pagado' ? 'Ya pagado' : money(total)}</b>
          <span className="muted"> {order.plannedPay ? PAY_LABEL[order.plannedPay] : ''}{order.cashWith ? ` · paga con ${money(order.cashWith)} → vuelto ${money(order.cashWith - total)}` : ''}</span>
        </div>
      </div>

      <div className="row gap wrap">
        <a className="btn wa grow" href={waLink(c.phone)} target="_blank" rel="noreferrer">💬 WhatsApp</a>
        <a className="btn grow" href={`tel:${c.phone.replace(/\s/g, '')}`}>📞 Llamar</a>
        <a className="btn maps grow" href={mapsLink(c.mapsUrl, c.address)} target="_blank" rel="noreferrer">📍 Google Maps</a>
      </div>

      <details><summary>Ver pedido ({order.items.reduce((s, i) => s + i.qty, 0)} ítems)</summary><ItemLines items={order.items} /></details>

      {free ? (
        <button className="btn primary block" onClick={() => assignDriver(order.id, user.id, user)}>Tomar este pedido</button>
      ) : !order.closed && (
        <div className="steps">
          {STEPS.map((s, i) => (i === doneIdx + 1 ? (
            <a key={s.to} className="btn step primary" href={stepLink(s)} target="_blank" rel="noreferrer" onClick={() => setDeliveryStatus(order.id, s.to, user)}>{s.label}</a>
          ) : (
            <button key={s.to} className={i <= doneIdx ? 'btn step done' : 'btn step'} disabled>{i <= doneIdx ? '✓ ' : ''}{s.label}</button>
          )))}
          <p className="muted small full">Al marcar cada estado se abre WhatsApp con el mensaje listo para el cliente.</p>
        </div>
      )}
    </article>
  );
}
