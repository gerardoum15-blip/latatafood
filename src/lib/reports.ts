import type { Channel, DB, Order, PayMethod } from '../types';
import { orderTotal } from '../data/store';
import { dayKey } from './format';

export type Period = 'hoy' | 'ayer' | 'semana' | 'mes' | 'anio' | 'rango';

export const PERIOD_LABEL: Record<Period, string> = {
  hoy: 'Hoy', ayer: 'Ayer', semana: 'Esta semana', mes: 'Este mes', anio: 'Este año', rango: 'Rango',
};

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function periodRange(p: Period, from?: string, to?: string): [number, number] {
  const now = new Date();
  const today = startOfDay(now);
  const DAY = 86400000;
  switch (p) {
    case 'hoy': return [today.getTime(), today.getTime() + DAY];
    case 'ayer': return [today.getTime() - DAY, today.getTime()];
    case 'semana': {
      const dow = (today.getDay() + 6) % 7; // lunes = 0
      const s = today.getTime() - dow * DAY;
      return [s, s + 7 * DAY];
    }
    case 'mes': return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()];
    case 'anio': return [new Date(now.getFullYear(), 0, 1).getTime(), new Date(now.getFullYear() + 1, 0, 1).getTime()];
    case 'rango': {
      const f = from ? new Date(from + 'T00:00:00').getTime() : today.getTime();
      const t = to ? new Date(to + 'T00:00:00').getTime() + DAY : today.getTime() + DAY;
      return [f, t];
    }
  }
}

export interface ReportFilter {
  from: number;
  to: number;
  localId: string | 'all';
  channel: Channel | 'all';
}

export function filterSales(db: DB, f: ReportFilter): Order[] {
  return db.orders.filter((o) =>
    o.closed && !o.cancelled && o.closedAt !== null &&
    o.closedAt >= f.from && o.closedAt < f.to &&
    (f.localId === 'all' || o.localId === f.localId) &&
    (f.channel === 'all' || o.channel === f.channel));
}

export interface ItemRow {
  productId: string;
  name: string;
  category: string;
  qty: number;
  amount: number;
  salonQty: number;
  deliveryQty: number;
}

export interface VariantRow {
  key: string;
  product: string;
  variant: string;
  qty: number;
  amount: number;
}

export interface Report {
  orders: Order[];
  total: number;
  itemsTotal: number;
  deliveryFees: number;
  count: number;
  avgTicket: number;
  salon: { count: number; total: number };
  delivery: { count: number; total: number };
  byDay: { day: string; total: number; count: number; salon: number; delivery: number }[];
  byItem: ItemRow[];
  byVariant: VariantRow[];
  byPay: { method: PayMethod; total: number; count: number }[];
  byLocal: { localId: string; name: string; total: number; count: number }[];
  byDriver: { name: string; count: number; total: number }[];
  avgKitchenMin: number | null;
  avgDeliveryMin: number | null;
}

export function buildReport(db: DB, f: ReportFilter): Report {
  const orders = filterSales(db, f);
  const catName = (pid: string) => {
    if (pid.startsWith('custom:')) return 'Plato momentáneo';
    const p = db.products.find((x) => x.id === pid);
    return db.categories.find((c) => c.id === p?.categoryId)?.name ?? '—';
  };

  let total = 0, itemsTotal = 0, deliveryFees = 0;
  const salon = { count: 0, total: 0 };
  const delivery = { count: 0, total: 0 };
  const days = new Map<string, { day: string; total: number; count: number; salon: number; delivery: number }>();
  const items = new Map<string, ItemRow>();
  const variants = new Map<string, VariantRow>();
  const pays = new Map<PayMethod, { method: PayMethod; total: number; count: number }>();
  const locals = new Map<string, { localId: string; name: string; total: number; count: number }>();
  const drivers = new Map<string, { name: string; count: number; total: number }>();
  let kSum = 0, kN = 0, dSum = 0, dN = 0;

  for (const o of orders) {
    const t = orderTotal(o);
    total += t;
    deliveryFees += o.deliveryFee || 0;
    const bucket = o.channel === 'salon' ? salon : delivery;
    bucket.count++; bucket.total += t;

    const dk = dayKey(o.closedAt!);
    const day = days.get(dk) ?? { day: dk, total: 0, count: 0, salon: 0, delivery: 0 };
    day.total += t; day.count++; day[o.channel] += t;
    days.set(dk, day);

    for (const it of o.items) {
      const amount = it.unitPrice * it.qty;
      itemsTotal += amount;
      const row = items.get(it.productId) ?? { productId: it.productId, name: it.name, category: catName(it.productId), qty: 0, amount: 0, salonQty: 0, deliveryQty: 0 };
      row.qty += it.qty; row.amount += amount;
      if (o.channel === 'salon') row.salonQty += it.qty; else row.deliveryQty += it.qty;
      items.set(it.productId, row);

      const variant = it.modifiers.map((m) => (m.qty > 1 ? `${m.qty}× ${m.optionName}` : m.optionName)).join(', ') || 'Sin personalizar';
      const vk = `${it.productId}|${variant}`;
      const v = variants.get(vk) ?? { key: vk, product: it.name, variant, qty: 0, amount: 0 };
      v.qty += it.qty; v.amount += amount;
      variants.set(vk, v);
    }

    for (const p of o.payments) {
      const pr = pays.get(p.method) ?? { method: p.method, total: 0, count: 0 };
      pr.total += p.amount; pr.count++;
      pays.set(p.method, pr);
    }

    const lr = locals.get(o.localId) ?? { localId: o.localId, name: db.locales.find((l) => l.id === o.localId)?.name ?? '—', total: 0, count: 0 };
    lr.total += t; lr.count++;
    locals.set(o.localId, lr);

    if (o.channel === 'delivery') {
      const name = db.users.find((u) => u.id === o.driverId)?.name ?? 'Sin driver';
      const dr = drivers.get(name) ?? { name, count: 0, total: 0 };
      dr.count++; dr.total += t;
      drivers.set(name, dr);
    }

    if (o.readyAt) { kSum += (o.readyAt - o.sentAt) / 60000; kN++; }
    if (o.channel === 'delivery' && o.readyAt && o.closedAt) { dSum += (o.closedAt - o.readyAt) / 60000; dN++; }
  }

  const byItem = [...items.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount);
  return {
    orders,
    total,
    itemsTotal,
    deliveryFees,
    count: orders.length,
    avgTicket: orders.length ? total / orders.length : 0,
    salon,
    delivery,
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byItem,
    byVariant: [...variants.values()].sort((a, b) => a.product.localeCompare(b.product) || b.qty - a.qty),
    byPay: [...pays.values()].sort((a, b) => b.total - a.total),
    byLocal: [...locals.values()].sort((a, b) => b.total - a.total),
    byDriver: [...drivers.values()].sort((a, b) => b.count - a.count),
    avgKitchenMin: kN ? kSum / kN : null,
    avgDeliveryMin: dN ? dSum / dN : null,
  };
}
