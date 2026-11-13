import { useMemo, useState } from 'react';
import { useDb } from '../data/store';
import { PAY_LABEL, type Channel } from '../types';
import { fmtMinutes, money } from '../lib/format';
import { buildReport, PERIOD_LABEL, periodRange, type Period } from '../lib/reports';
import { LocalPicker } from '../components/shared';
import { Empty, Tabs } from '../components/ui';

export function ReportsScreen() {
  const db = useDb();
  const [period, setPeriod] = useState<Period>('hoy');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [localId, setLocalId] = useState<string>('all');
  const [channel, setChannel] = useState<Channel | 'all'>('all');
  const [view, setView] = useState<'items' | 'variantes' | 'dias' | 'pagos'>('items');

  const [a, b] = periodRange(period, from, to);
  const rep = useMemo(() => buildReport(db, { from: a, to: b, localId, channel }), [db, a, b, localId, channel]);
  const localName = localId === 'all' ? 'Todos los locales' : db.locales.find((l) => l.id === localId)?.name ?? '';
  const chanName = channel === 'all' ? 'Salón y delivery' : channel === 'salon' ? 'Solo salón' : 'Solo delivery';
  const rangeText = `${new Date(a).toLocaleDateString('es-PE')} – ${new Date(b - 1).toLocaleDateString('es-PE')}`;
  const maxDay = Math.max(1, ...rep.byDay.map((d) => d.total));
  const maxItem = Math.max(1, ...rep.byItem.map((i) => i.qty));

  return (
    <div className="page wide">
      <div className="section-head"><h2>Reportes</h2>
        <button className="btn small" disabled={rep.count === 0} onClick={() => void import('../lib/exportXlsx').then((m) => m.exportReport(db, rep, `${PERIOD_LABEL[period]} ${rangeText} ${localName} ${chanName}`))}>⬇ Exportar Excel</button>
      </div>

      <div className="filters">
        <div className="chips">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button key={p} className={period === p ? 'chip active' : 'chip'} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
        {period === 'rango' && (
          <div className="row gap wrap">
            <label className="field inline"><span>Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field inline"><span>Hasta</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )}
        <LocalPicker value={localId} onChange={setLocalId} allowAll />
        <div className="local-picker">
          {(['all', 'salon', 'delivery'] as const).map((c) => (
            <button key={c} className={channel === c ? 'seg active' : 'seg'} onClick={() => setChannel(c)}>
              {c === 'all' ? 'Salón + delivery' : c === 'salon' ? 'Salón' : 'Delivery'}
            </button>
          ))}
        </div>
        <p className="muted small">{rangeText} · {localName} · {chanName}</p>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Ventas</span><b>{money(rep.total)}</b></div>
        <div className="kpi"><span>Tickets</span><b>{rep.count}</b></div>
        <div className="kpi"><span>Ticket promedio</span><b>{money(rep.avgTicket)}</b></div>
        <div className="kpi"><span>Salón</span><b>{money(rep.salon.total)}</b><small>{rep.salon.count} tickets</small></div>
        <div className="kpi"><span>Delivery</span><b>{money(rep.delivery.total)}</b><small>{rep.delivery.count} pedidos · empaques {money(rep.packaging)}</small></div>
        <div className="kpi"><span>Descuentos</span><b>{money(rep.discounts)}</b><small>dados a clientes</small></div>
        <div className="kpi"><span>Tiempo cocina</span><b>{rep.avgKitchenMin !== null ? fmtMinutes(rep.avgKitchenMin) : '—'}</b><small>promedio hasta "Listo"</small></div>
        {rep.avgDeliveryMin !== null && <div className="kpi"><span>Tiempo de entrega</span><b>{fmtMinutes(rep.avgDeliveryMin)}</b><small>de "Listo" a "Entregado"</small></div>}
      </div>

      {rep.count === 0 ? <Empty>No hay ventas en este periodo.</Empty> : (
        <>
          <Tabs value={view} onChange={setView} options={[
            { value: 'items', label: 'Por ítem' },
            { value: 'variantes', label: 'Por personalización' },
            { value: 'dias', label: 'Por día' },
            { value: 'pagos', label: 'Pagos / locales' },
          ]} />

          {view === 'items' && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>#</th><th>Producto</th><th className="num">Cant.</th><th className="num hide-sm">Salón</th><th className="num hide-sm">Delivery</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {rep.byItem.map((i, idx) => (
                    <tr key={i.productId}>
                      <td>{idx + 1}</td>
                      <td>{i.name}<div className="bar" style={{ width: `${(i.qty / maxItem) * 100}%` }} /><small className="muted">{i.category}</small><small className="muted show-sm"> · salón {i.salonQty} · delivery {i.deliveryQty}</small></td>
                      <td className="num"><b>{i.qty}</b></td><td className="num hide-sm">{i.salonQty}</td><td className="num hide-sm">{i.deliveryQty}</td>
                      <td className="num">{money(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td /><td>Total ítems</td><td className="num">{rep.byItem.reduce((s, i) => s + i.qty, 0)}</td><td className="hide-sm" /><td className="hide-sm" /><td className="num">{money(rep.itemsTotal)}</td></tr></tfoot>
              </table>
            </div>
          )}

          {view === 'variantes' && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Producto</th><th>Personalización</th><th className="num">Cant.</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {rep.byVariant.map((v) => (
                    <tr key={v.key}><td>{v.product}</td><td className="small">{v.variant}</td><td className="num"><b>{v.qty}</b></td><td className="num">{money(v.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === 'dias' && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Fecha</th><th className="num">Tickets</th><th className="num hide-sm">Salón</th><th className="num hide-sm">Delivery</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {[...rep.byDay].reverse().map((d) => (
                    <tr key={d.day}>
                      <td>{new Date(d.day + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' })}<div className="bar" style={{ width: `${(d.total / maxDay) * 100}%` }} /></td>
                      <td className="num">{d.count}</td><td className="num hide-sm">{money(d.salon)}</td><td className="num hide-sm">{money(d.delivery)}</td><td className="num"><b>{money(d.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === 'pagos' && (
            <div className="grid-2">
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Forma de pago</th><th className="num">Ops.</th><th className="num">Monto</th></tr></thead>
                  <tbody>{rep.byPay.map((p) => <tr key={p.method}><td>{PAY_LABEL[p.method]}</td><td className="num">{p.count}</td><td className="num">{money(p.total)}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Local</th><th className="num">Tickets</th><th className="num">Ventas</th></tr></thead>
                  <tbody>{rep.byLocal.map((l) => <tr key={l.localId}><td>{l.name}</td><td className="num">{l.count}</td><td className="num">{money(l.total)}</td></tr>)}</tbody>
                </table>
              </div>
              {rep.byDriver.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Driver</th><th className="num">Entregas</th><th className="num">Monto</th></tr></thead>
                    <tbody>{rep.byDriver.map((d) => <tr key={d.name}><td>{d.name}</td><td className="num">{d.count}</td><td className="num">{money(d.total)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
