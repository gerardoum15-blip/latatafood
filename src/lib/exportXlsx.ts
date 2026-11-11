import * as XLSX from 'xlsx';
import type { DB } from '../types';
import { PAY_LABEL } from '../types';
import { orderTotal, packagingTotal } from '../data/store';
import type { Report } from './reports';
import { dateTime } from './format';

const r2 = (n: number) => Math.round(n * 100) / 100;

export function exportReport(db: DB, rep: Report, title: string) {
  const wb = XLSX.utils.book_new();
  const localName = (id: string) => db.locales.find((l) => l.id === id)?.name ?? '';

  const resumen = [
    ['Reporte', title],
    ['Ventas totales', r2(rep.total)],
    ['N.° de tickets', rep.count],
    ['Ticket promedio', r2(rep.avgTicket)],
    ['Salón: tickets', rep.salon.count], ['Salón: ventas', r2(rep.salon.total)],
    ['Delivery: pedidos', rep.delivery.count], ['Delivery: ventas', r2(rep.delivery.total)],
    ['Empaques cobrados', r2(rep.packaging)],
    [],
    ['Forma de pago', 'Monto', 'Operaciones'],
    ...rep.byPay.map((p) => [PAY_LABEL[p.method], r2(p.total), p.count]),
    [],
    ['Local', 'Ventas', 'Tickets'],
    ...rep.byLocal.map((l) => [l.name, r2(l.total), l.count]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rep.byDay.map((d) => ({
    Fecha: d.day, Tickets: d.count, Salón: r2(d.salon), Delivery: r2(d.delivery), Total: r2(d.total),
  }))), 'Ventas por día');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rep.byItem.map((i, idx) => ({
    Puesto: idx + 1, Producto: i.name, Categoría: i.category, Cantidad: i.qty,
    'Cant. salón': i.salonQty, 'Cant. delivery': i.deliveryQty, Monto: r2(i.amount),
  }))), 'Ventas por ítem');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rep.byVariant.map((v) => ({
    Producto: v.product, Personalización: v.variant, Cantidad: v.qty, Monto: r2(v.amount),
  }))), 'Detalle personalización');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rep.orders.map((o) => ({
    Fecha: dateTime(o.closedAt!), Local: localName(o.localId), Número: o.number,
    Canal: o.channel === 'salon' ? `Salón (mesa ${o.table})` : 'Delivery',
    Cliente: o.customer?.name ?? '',
    Ítems: o.items.map((i) => `${i.qty}× ${i.name}`).join(' | '),
    Empaques: o.packagingQty ?? 0, 'Monto empaques': r2(packagingTotal(o)), Total: r2(orderTotal(o)),
    Pago: o.payments.map((p) => PAY_LABEL[p.method]).join(' + '),
    Driver: db.users.find((u) => u.id === o.driverId)?.name ?? '',
  }))), 'Tickets');

  XLSX.writeFile(wb, `reporte-${title.replace(/[^\w-]+/g, '_')}.xlsx`);
}
