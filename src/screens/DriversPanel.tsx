import { useMemo, useState } from 'react';
import { orderTotal, useDb } from '../data/store';
import { useDriverLocations } from '../data/cloud';
import { DELIVERY_LABEL, PAY_LABEL } from '../types';
import { dayKey, money, orderNo, time } from '../lib/format';
import { LiveMap, type MapPoint } from '../components/LiveMap';
import { Empty, useTick } from '../components/ui';

const minsAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const ageText = (m: number) => (m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`);

/** Drivers: ubicación en vivo, pedidos que llevan y pedidos entregados. */
export function DriversPanel({ showMoney }: { showMoney?: boolean }) {
  const db = useDb();
  const locs = useDriverLocations();
  useTick(20000);
  const [day, setDay] = useState(dayKey(Date.now()));
  const drivers = db.users.filter((u) => u.role === 'driver' && u.active);

  const points: MapPoint[] = useMemo(() => locs
    .filter((l) => drivers.some((d) => d.id === l.user_id) && minsAgo(l.updated_at) < 12 * 60)
    .map((l) => {
      const d = drivers.find((x) => x.id === l.user_id)!;
      const old = minsAgo(l.updated_at) > 5;
      return { id: l.user_id, lat: l.lat, lng: l.lng, label: `${d.name.split(' ')[0]}${old ? ` · ${ageText(minsAgo(l.updated_at))}` : ''}`, kind: old ? 'driver-old' : 'driver' };
    }), [locs, drivers]);

  return (
    <div className="page wide">
      <div className="section-head">
        <h2>Drivers</h2>
        <label className="field inline"><span>Entregas del</span><input id="drv-day" type="date" value={day} max={dayKey(Date.now())} onChange={(e) => setDay(e.target.value || dayKey(Date.now()))} /></label>
      </div>
      {points.length ? <LiveMap points={points} height={320} follow={false} /> : (
        <Empty>Ningún driver está compartiendo su ubicación. Se ve cuando el driver tiene la app abierta con la ubicación activada.</Empty>
      )}
      <div className="cards">
        {drivers.map((d) => {
          const loc = locs.find((l) => l.user_id === d.id);
          const age = loc ? minsAgo(loc.updated_at) : null;
          const active = db.orders.filter((o) => o.channel === 'delivery' && o.driverId === d.id && !o.closed && !o.cancelled).sort((a, b) => a.createdAt - b.createdAt);
          const done = db.orders.filter((o) => o.channel === 'delivery' && o.driverId === d.id && o.closed && !o.cancelled && dayKey(o.closedAt ?? o.createdAt) === day);
          const cash = done.reduce((s, o) => s + o.payments.filter((p) => p.method === 'efectivo').reduce((a, p) => a + p.amount, 0), 0);
          return (
            <article key={d.id} className="card driver-card">
              <div className="row between wrap">
                <b>{d.name}</b>
                <span className={age !== null && age <= 5 ? 'status s-listo' : 'status s-anulado'}>
                  {age === null ? 'Sin ubicación' : age <= 5 ? `En línea · ${ageText(age)}` : `Última ubicación ${ageText(age)}`}
                </span>
              </div>
              {loc && <a className="small" href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer">Abrir en Google Maps</a>}
              <h4>Lleva ahora ({active.length})</h4>
              {active.length === 0 ? <p className="muted small">Sin pedidos en curso.</p> : (
                <ul className="list">
                  {active.map((o) => (
                    <li key={o.id}>
                      <span className="grow">{orderNo(o)} · {o.customer?.name}<span className="muted small"> · {o.customer?.address}</span></span>
                      <span className={`status d-${o.deliveryStatus}`}>{o.deliveryStatus ? DELIVERY_LABEL[o.deliveryStatus] : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              <h4>Entregados ({done.length}){showMoney && done.length > 0 && <span className="muted small"> · {money(done.reduce((s, o) => s + orderTotal(o), 0))} · efectivo {money(cash)}</span>}</h4>
              {done.length > 0 && (
                <details>
                  <summary>Ver entregas</summary>
                  <ul className="list">
                    {done.map((o) => (
                      <li key={o.id}>
                        <span className="grow">{orderNo(o)} · {o.customer?.name}</span>
                        <span className="muted small">{o.closedAt ? time(o.closedAt) : ''}</span>
                        {showMoney && <b>{money(orderTotal(o))}</b>}
                        {showMoney && <span className="muted small">{o.payments.map((p) => PAY_LABEL[p.method]).join(' + ')}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
