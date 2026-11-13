import { useMemo, useState } from 'react';
import { assignDriver, cancelOrder, deleteOrder, orderTotal, packagingTotal, setDeliveryStatus, useDb, useSession, withoutDriver } from '../data/store';
import { PAY_LABEL, type Order } from '../types';
import { dayKey, money, time, orderNo } from '../lib/format';
import { orderStage, stageHint, STAGE_LABEL, STAGES, type Stage } from '../lib/status';
import { LocalPicker } from '../components/shared';
import { ConfirmButton, Empty, ItemLines, Timeline, useTick } from '../components/ui';
import { TicketButton } from '../components/TicketButton';

/** Registro de pedidos con color por estado. Lo ven todos los usuarios. */
/** `lockLocal`: cocina y mozo de mesa solo ven su local. */
export function OrderLog({ admin, defaultLocal = 'all', lockLocal }: { admin?: boolean; defaultLocal?: string; lockLocal?: string }) {
  const db = useDb();
  useTick();
  const [day, setDay] = useState(dayKey(Date.now()));
  const [localPick, setLocalId] = useState(defaultLocal);
  const localId = lockLocal ?? localPick;
  const [channel, setChannel] = useState<'all' | 'salon' | 'delivery'>('all');
  const [stage, setStage] = useState<Stage | 'all'>('all');

  const ofDay = useMemo(() => db.orders.filter((o) => dayKey(o.createdAt) === day
    && (localId === 'all' || o.localId === localId)
    && (channel === 'all' || o.channel === channel)), [db.orders, day, localId, channel]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
    ofDay.forEach((o) => { c[orderStage(o)]++; });
    return c;
  }, [ofDay]);
  const list = ofDay.filter((o) => stage === 'all' || orderStage(o) === stage).sort((a, b) => b.createdAt - a.createdAt);
  const isToday = day === dayKey(Date.now());

  return (
    <div className="page wide">
      <div className="section-head">
        <h2>Registro de pedidos</h2>
        <label className="field inline"><span>Fecha</span><input id="log-day" type="date" value={day} max={dayKey(Date.now())} onChange={(e) => setDay(e.target.value || dayKey(Date.now()))} /></label>
      </div>
      <div className="filters">
        <LocalPicker value={localId} onChange={setLocalId} allowAll={!lockLocal} fixed={!!lockLocal} />
        <div className="local-picker">
          {(['all', 'salon', 'delivery'] as const).map((c) => (
            <button key={c} className={channel === c ? 'seg active' : 'seg'} onClick={() => setChannel(c)}>
              {c === 'all' ? 'Salón + delivery' : c === 'salon' ? 'Salón' : 'Delivery'}
            </button>
          ))}
        </div>
        <div className="chips stage-chips">
          <button className={stage === 'all' ? 'chip active' : 'chip'} onClick={() => setStage('all')}>Todos {ofDay.length}</button>
          {STAGES.filter((s) => s !== 'anulado' || counts.anulado > 0).map((s) => (
            <button key={s} className={`chip stage-chip st-${s}${stage === s ? ' active' : ''}`} onClick={() => setStage(s)}>
              <span className="dot" aria-hidden />{STAGE_LABEL[s]} {counts[s]}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? <Empty>{isToday ? 'Aún no hay pedidos hoy.' : 'No hay pedidos en esta fecha.'}</Empty> : (
        <div className="cards">{list.map((o) => <LogTicket key={o.id} order={o} admin={admin} />)}</div>
      )}
    </div>
  );
}

function LogTicket({ order, admin }: { order: Order; admin?: boolean }) {
  const db = useDb();
  const me = useSession()!;
  const st = orderStage(order);
  const hint = stageHint(order);
  const local = db.locales.find((l) => l.id === order.localId);
  const driver = db.users.find((u) => u.id === order.driverId);
  const drivers = db.users.filter((u) => u.role === 'driver' && u.active);
  const pkg = packagingTotal(order);
  return (
    <article className={`card log-ticket st-${st}`}>
      <div className="row between wrap">
        <b>{orderNo(order)} · {order.channel === 'salon' ? `Mesa ${order.table}` : `🛵 ${order.customer?.name}`}</b>
        <span className="stage-badge">{STAGE_LABEL[st]}{hint ? ` · ${hint}` : ''}</span>
      </div>
      <div className="muted small">
        {local?.name} · {time(order.createdAt)} · {order.createdByName}
        {order.channel === 'delivery' && ` · ${withoutDriver(order) ? (order.selfDelivery === 'indrive' ? 'InDrive' : 'Recojo') : driver ? `Driver: ${driver.name}` : 'sin driver'}`}
      </div>
      <div className="small">{order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
      <div className="row between">
        <span className="muted small">
          {order.channel === 'delivery' && order.plannedPay ? PAY_LABEL[order.plannedPay] : order.payments.map((p) => PAY_LABEL[p.method]).join(' + ')}
          {pkg > 0 && ` · empaques ${money(pkg)}`}
        </span>
        <span className="row gap"><TicketButton order={order} /><b>{money(orderTotal(order))}</b></span>
      </div>
      {admin && !order.closed && (
        <div className="row gap wrap">
          {order.channel === 'delivery' && (
            <select aria-label="Driver" value={order.driverId ?? ''} onChange={(e) => assignDriver(order.id, e.target.value || null, me)}>
              <option value="">Sin driver</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <ConfirmButton className="btn small ghost danger" label="Anular" title={`Anular pedido ${orderNo(order)}`} message="El pedido no contará en las ventas." reason confirmLabel="Anular pedido" onConfirm={(r) => cancelOrder(order.id, r, me)} />
        </div>
      )}
      {withoutDriver(order) && !order.closed && !order.cancelled && (me.role === 'delivery' || me.role === 'admin') && (
        <div className="row gap wrap self-delivery">
          <span className="small"><b>{order.selfDelivery === 'indrive' ? '🚗 Envío por InDrive' : '🏪 Recoge en local'}</b></span>
          {order.selfDelivery === 'indrive' && order.deliveryStatus === 'pendiente' && (
            <button className="btn small" onClick={() => setDeliveryStatus(order.id, 'en_camino', me)}>Enviado por InDrive</button>
          )}
          <button className="btn small ok" onClick={() => setDeliveryStatus(order.id, 'entregado', me)}>✅ {order.selfDelivery === 'indrive' ? 'Entregado' : 'Entregado al cliente'}</button>
        </div>
      )}
      {admin && (
        <div className="row gap wrap">
          <ConfirmButton className="btn small ghost danger" label="🗑 Borrar pedido" title={`Borrar pedido ${orderNo(order)}`} message="Se borrará por completo: no contará en ventas ni aparecerá en el registro. No se puede deshacer." confirmLabel="Borrar definitivamente" onConfirm={() => deleteOrder(order.id)} />
        </div>
      )}
      <details>
        <summary>Detalle e historial</summary>
        {order.customer && (
          <p className="small">{order.customer.phone} · {order.customer.address}</p>
        )}
        <ItemLines items={order.items} />
        {order.note && <p className="item-note">📝 {order.note}</p>}
        <Timeline order={order} />
      </details>
    </article>
  );
}
