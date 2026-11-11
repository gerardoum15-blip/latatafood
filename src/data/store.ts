import { useSyncExternalStore } from 'react';
import type {
  Customer, DB, DeliveryStatus, KitchenStatus, Order, OrderItem, Payment, PayMethod, User,
} from '../types';
import { DELIVERY_LABEL, KITCHEN_LABEL } from '../types';
import { createSeed } from './seed';

/**
 * Almacenamiento local (modo demo, un solo dispositivo; sincroniza entre pestañas).
 * Toda la app accede a los datos solo mediante este módulo, para poder cambiarlo
 * después por una base de datos en la nube (Supabase) sin tocar las pantallas.
 */

const KEY = 'pos-restaurante-db-v2';
const SESSION_KEY = 'pos-restaurante-session';

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}
function safeRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
}

function load(): DB {
  const raw = safeGet(KEY);
  if (raw) {
    try { return JSON.parse(raw) as DB; } catch { /* datos dañados: reiniciar */ }
  }
  return createSeed();
}

let db: DB = load();
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
try { channel = new BroadcastChannel('pos-restaurante'); } catch { channel = null; }

function emit() { listeners.forEach((l) => l()); }

function persist() {
  safeSet(KEY, JSON.stringify(db));
  channel?.postMessage('changed');
}

function reloadFromStorage() {
  const raw = safeGet(KEY);
  if (!raw) return;
  try { db = JSON.parse(raw) as DB; emit(); } catch { /* ignorar */ }
}

channel?.addEventListener('message', reloadFromStorage);
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) reloadFromStorage(); });
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function getDb() { return db; }

export function useDb(): DB {
  return useSyncExternalStore(subscribe, getDb, getDb);
}

export function mutate(fn: (draft: DB) => void) {
  const draft = structuredClone(db);
  fn(draft);
  db = draft;
  persist();
  emit();
}

export const uid = (prefix = 'id') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- Sesión ----------

let sessionUserId: string | null = safeGet(SESSION_KEY);
const sessionListeners = new Set<() => void>();

export function useSession(): User | null {
  const id = useSyncExternalStore(
    (l) => { sessionListeners.add(l); return () => { sessionListeners.delete(l); }; },
    () => sessionUserId,
    () => sessionUserId,
  );
  const data = useDb();
  return data.users.find((u) => u.id === id && u.active) ?? null;
}

export function login(userId: string) {
  sessionUserId = userId;
  safeSet(SESSION_KEY, userId);
  sessionListeners.forEach((l) => l());
}

export function logout() {
  sessionUserId = null;
  safeRemove(SESSION_KEY);
  sessionListeners.forEach((l) => l());
}

// ---------- Pedidos ----------

export const orderSubtotal = (o: Pick<Order, 'items'>) =>
  o.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);

export const orderTotal = (o: Pick<Order, 'items' | 'deliveryFee'>) =>
  orderSubtotal(o) + (o.deliveryFee || 0);

function event(user: User, label: string) {
  return { label, at: Date.now(), userId: user.id, userName: user.name };
}

export interface NewOrderInput {
  localId: string;
  channel: Order['channel'];
  table: number | null;
  customer: Customer | null;
  deliveryFee: number;
  plannedPay: PayMethod | null;
  cashWith: number | null;
  driverId: string | null;
  items: OrderItem[];
  note: string;
}

export function createOrder(input: NewOrderInput, user: User): string {
  const id = uid('o');
  mutate((d) => {
    const n = (d.counters[input.localId] ?? 0) + 1;
    d.counters[input.localId] = n;
    const now = Date.now();
    d.orders.push({
      id,
      number: n,
      ...input,
      items: input.items.map((i) => ({ ...i, round: 1 })),
      kitchenStatus: 'enviado',
      deliveryStatus: input.channel === 'delivery' ? 'pendiente' : null,
      served: false,
      closed: false,
      cancelled: false,
      payments: [],
      createdAt: now,
      createdBy: user.id,
      createdByName: user.name,
      sentAt: now,
      readyAt: null,
      closedAt: null,
      history: [event(user, 'Pedido creado y enviado a cocina')],
      sunat: { status: 'no_emitido', type: null },
    });
  });
  return id;
}

function withOrder(orderId: string, fn: (o: Order, d: DB) => void) {
  mutate((d) => {
    const o = d.orders.find((x) => x.id === orderId);
    if (o) fn(o, d);
  });
}

export function addItems(orderId: string, items: OrderItem[], user: User) {
  withOrder(orderId, (o) => {
    const round = Math.max(0, ...o.items.map((i) => i.round)) + 1;
    o.items.push(...items.map((i) => ({ ...i, round })));
    o.kitchenStatus = 'enviado';
    o.served = false;
    o.sentAt = Date.now();
    o.readyAt = null;
    o.history.push(event(user, `Se agregaron ${items.reduce((s, i) => s + i.qty, 0)} ítems (ronda ${round})`));
  });
}

export function setKitchenStatus(orderId: string, status: KitchenStatus, user: User) {
  withOrder(orderId, (o) => {
    o.kitchenStatus = status;
    if (status === 'listo') o.readyAt = Date.now();
    o.history.push(event(user, `Cocina: ${KITCHEN_LABEL[status]}`));
  });
}

export function setDeliveryStatus(orderId: string, status: DeliveryStatus, user: User) {
  withOrder(orderId, (o) => {
    o.deliveryStatus = status;
    o.history.push(event(user, `Delivery: ${DELIVERY_LABEL[status]}`));
    if (status === 'entregado') {
      o.closed = true;
      o.closedAt = Date.now();
      if (o.payments.length === 0) {
        o.payments = [{ method: o.plannedPay ?? 'efectivo', amount: orderTotal(o) }];
      }
    }
  });
}

export function assignDriver(orderId: string, driverId: string | null, user: User) {
  withOrder(orderId, (o, d) => {
    o.driverId = driverId;
    const name = d.users.find((u) => u.id === driverId)?.name ?? 'sin asignar';
    o.history.push(event(user, `Driver asignado: ${name}`));
  });
}

export function markServed(orderId: string, user: User) {
  withOrder(orderId, (o) => {
    o.served = true;
    o.history.push(event(user, 'Servido en mesa'));
  });
}

export function payOrder(orderId: string, payments: Payment[], user: User) {
  withOrder(orderId, (o) => {
    o.payments = payments;
    o.closed = true;
    o.closedAt = Date.now();
    o.history.push(event(user, 'Cobrado'));
  });
}

export function cancelOrder(orderId: string, reason: string, user: User) {
  withOrder(orderId, (o) => {
    o.cancelled = true;
    o.closed = true;
    o.closedAt = Date.now();
    o.history.push(event(user, `Anulado${reason ? `: ${reason}` : ''}`));
  });
}

// ---------- Utilidades de demo ----------

export function resetAll() {
  db = createSeed();
  persist();
  emit();
}

/** Genera ventas de ejemplo de los últimos días para probar los reportes. */
export function generateDemoSales(days = 60) {
  mutate((d) => {
    const products = d.products.filter((p) => p.active);
    const drivers = d.users.filter((u) => u.role === 'driver');
    const methods: PayMethod[] = ['efectivo', 'efectivo', 'yape', 'yape', 'plin', 'tarjeta'];
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    const now = new Date();
    for (let day = days; day >= 1; day--) {
      for (const local of d.locales) {
        const count = 8 + Math.floor(Math.random() * 18);
        for (let k = 0; k < count; k++) {
          const date = new Date(now);
          date.setDate(now.getDate() - day);
          date.setHours(12 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);
          const t = date.getTime();
          const isDelivery = Math.random() < 0.4;
          const items: OrderItem[] = [];
          const lines = 1 + Math.floor(Math.random() * 3);
          for (let j = 0; j < lines; j++) {
            const prod = pick(products);
            const modifiers = prod.groupIds
              .map((gid) => d.groups.find((g) => g.id === gid))
              .filter((g): g is NonNullable<typeof g> => !!g && g.kind === 'single')
              .map((g) => {
                const o = pick(g.options);
                return { groupId: g.id, groupName: g.name, optionId: o.id, optionName: o.name, qty: 1, price: o.price };
              });
            const unit = prod.price + modifiers.reduce((s, m) => s + m.price, 0);
            items.push({
              id: uid('i'), productId: prod.id, name: prod.name, basePrice: prod.price, unitPrice: unit,
              qty: 1 + Math.floor(Math.random() * 2), modifiers, note: '', round: 1,
            });
          }
          const n = (d.counters[local.id] ?? 0) + 1;
          d.counters[local.id] = n;
          const fee = isDelivery ? pick([3, 4, 5]) : 0;
          const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0) + fee;
          const driver = isDelivery ? pick(drivers) : null;
          const method = pick(methods);
          d.orders.push({
            id: uid('o'), number: n, localId: local.id, channel: isDelivery ? 'delivery' : 'salon',
            table: isDelivery ? null : 1 + Math.floor(Math.random() * local.tables),
            customer: isDelivery ? { name: pick(['Rosa', 'Miguel', 'Lucía', 'Pedro', 'Carmen', 'José']), phone: '987654321', address: 'Av. Ejemplo 123', reference: '', mapsUrl: '' } : null,
            deliveryFee: fee, plannedPay: isDelivery ? method : null, cashWith: null,
            driverId: driver?.id ?? null, items, note: '',
            kitchenStatus: 'listo', deliveryStatus: isDelivery ? 'entregado' : null,
            served: !isDelivery, closed: true, cancelled: false,
            payments: [{ method, amount: total }],
            createdAt: t, createdBy: 'demo', createdByName: 'Demo', sentAt: t,
            readyAt: t + (8 + Math.random() * 15) * 60000,
            closedAt: t + (isDelivery ? 35 + Math.random() * 25 : 40 + Math.random() * 30) * 60000,
            history: [], sunat: { status: 'no_emitido', type: null },
          });
        }
      }
    }
  });
}
