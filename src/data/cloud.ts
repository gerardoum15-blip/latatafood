import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import type { DB, Order } from '../types';

/**
 * Conexión con Supabase. La clave "publishable" es pública por diseño: la seguridad
 * la ponen las reglas de la base de datos (ver supabase/setup.sql).
 */
export const SUPABASE_URL = 'https://ivenlwsnffkijnzowoga.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_eIY1-eyvBl6TW_M_G4JNgA_8HOhyJTF';
export const STAFF_EMAIL = 'personal@latatafood.app';
export const CLOUD = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = CLOUD
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'latatafood-auth' } })
  : null;

/** Días de pedidos que se cargan en cada dispositivo (para reportes del año). */
const HISTORY_DAYS = 400;

// ---------- Estado de la conexión ----------

export type CloudStatus = 'checking' | 'signed-out' | 'loading' | 'ready' | 'error';
interface CloudState { status: CloudStatus; catalogReady: boolean; online: boolean; pending: number; error: string }
let state: CloudState = { status: CLOUD ? 'checking' : 'ready', catalogReady: !CLOUD, online: true, pending: 0, error: '' };
const stateListeners = new Set<() => void>();
function setState(patch: Partial<CloudState>) {
  state = { ...state, ...patch };
  stateListeners.forEach((l) => l());
}
export function useCloud(): CloudState {
  return useSyncExternalStore((l) => { stateListeners.add(l); return () => { stateListeners.delete(l); }; }, () => state, () => state);
}

// ---------- Puente con el almacén local ----------

export interface StoreApi {
  getDb: () => DB;
  replaceDb: (next: DB) => void;
}
let api: StoreApi | null = null;

type Catalog = Pick<DB, 'settings' | 'locales' | 'categories' | 'groups' | 'products'>;
type Staff = Pick<DB, 'users'>;
const catalogOf = (d: DB): Catalog => ({ settings: d.settings, locales: d.locales, categories: d.categories, groups: d.groups, products: d.products });
const staffOf = (d: DB): Staff => ({ users: d.users });

/** Última versión confirmada por el servidor de cada pedido (para unir cambios simultáneos). */
const versions = new Map<string, number>();
const base = new Map<string, Order>();
const queue = new Set<string>(); // 'doc:catalog' | 'doc:staff' | 'order:<id>'
let running = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let channel: RealtimeChannel | null = null;
let current: string | null = null;
const dirtyAgain = new Set<string>();

// ---------- Inicio ----------

export async function startCloud(storeApi: StoreApi) {
  api = storeApi;
  if (!supabase) return;
  loadCatalog();
  const { data } = await supabase.auth.getSession();
  if (data.session) await loadAll();
  else setState({ status: 'signed-out' });
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { channel?.unsubscribe(); channel = null; setState({ status: 'signed-out' }); }
  });
  window.addEventListener('online', () => { setState({ online: true }); kick(); });
  window.addEventListener('offline', () => setState({ online: false }));
}

/** La carta se puede leer sin clave (para la carta de clientes). */
async function loadCatalog() {
  if (!supabase || !api) return;
  const { data, error } = await supabase.from('app_docs').select('data').eq('id', 'catalog').maybeSingle();
  if (!error && data) api.replaceDb({ ...api.getDb(), ...(data.data as Catalog) });
  setState({ catalogReady: true });
}

export async function signInDevice(password: string): Promise<string | null> {
  if (!supabase) return null;
  const { error } = await supabase.auth.signInWithPassword({ email: STAFF_EMAIL, password });
  if (error) return error.message.includes('Invalid') ? 'Clave incorrecta. Revísala e inténtalo de nuevo.' : `No se pudo conectar: ${error.message}`;
  await loadAll();
  return null;
}

export async function signOutDevice() {
  await supabase?.auth.signOut();
}

async function loadAll() {
  if (!supabase || !api) return;
  setState({ status: 'loading', error: '' });
  try {
    const docs = await supabase.from('app_docs').select('id,data');
    if (docs.error) throw docs.error;
    const local = api.getDb();
    const catalog = docs.data.find((d) => d.id === 'catalog')?.data as Catalog | undefined;
    const staff = docs.data.find((d) => d.id === 'staff')?.data as Staff | undefined;

    const since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
    const orders: Order[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await supabase.from('orders').select('id,version,data').gte('created_at', since).order('created_at').range(from, from + 999);
      if (r.error) throw r.error;
      for (const row of r.data) {
        versions.set(row.id, row.version);
        base.set(row.id, row.data as Order);
        orders.push(row.data as Order);
      }
      if (r.data.length < 1000) break;
    }

    api.replaceDb({ ...local, ...(catalog ?? catalogOf(local)), ...(staff ?? staffOf(local)), orders });
    // Primera vez: subir la carta y los usuarios iniciales.
    if (!catalog) queue.add('doc:catalog');
    if (!staff) queue.add('doc:staff');
    subscribeRealtime();
    setState({ status: 'ready', catalogReady: true });
    kick();
  } catch (e) {
    setState({ status: 'error', error: describeError(e) });
  }
}

export function retryLoad() { loadAll(); }

/** Mensaje entendible para los errores de Supabase. */
function describeError(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string };
  if (err.code === 'PGRST205' || err.code === '42P01' || /schema cache|does not exist/i.test(err.message ?? '')) {
    return 'Faltan las tablas en Supabase: ejecuta el texto de configuración en el SQL Editor (Paso 3) y toca Reintentar.';
  }
  if (err.code === '42501' || /permission|row-level/i.test(err.message ?? '')) {
    return 'Supabase no dio permiso. Revisa que el usuario sea personal@latatafood.app y que se haya ejecutado el Paso 3.';
  }
  if (e instanceof TypeError || /fetch|network/i.test(err.message ?? '')) return 'Sin conexión a internet.';
  return [err.code, err.message].filter(Boolean).join(' · ') || String(e);
}

function subscribeRealtime() {
  if (!supabase || channel) return;
  channel = supabase.channel('latatafood')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (p) => {
      const row = p.new as { id?: string; version?: number; data?: Order };
      if (!row?.id || !row.data || !api) return;
      if ((versions.get(row.id) ?? 0) >= (row.version ?? 0)) return;
      versions.set(row.id, row.version ?? 1);
      base.set(row.id, row.data);
      if (queue.has(`order:${row.id}`)) return; // tenemos cambios propios pendientes: se unen al guardar
      const d = api.getDb();
      const i = d.orders.findIndex((o) => o.id === row.id);
      const orders = d.orders.slice();
      if (i >= 0) orders[i] = row.data; else orders.push(row.data);
      api.replaceDb({ ...d, orders });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_docs' }, (p) => {
      const row = p.new as { id?: string; data?: Catalog | Staff };
      if (!row?.id || !row.data || !api || queue.has(`doc:${row.id}`)) return;
      api.replaceDb({ ...api.getDb(), ...row.data });
    })
    .subscribe((status) => {
      // Al reconectar, recargar para no perder cambios hechos mientras no había señal.
      if (status === 'SUBSCRIBED' && state.status === 'ready') refreshOrders();
    });
}

async function refreshOrders() {
  if (!supabase || !api) return;
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const r = await supabase.from('orders').select('id,version,data').gte('updated_at', since);
  if (r.error) return;
  const d = api.getDb();
  const orders = d.orders.slice();
  let changed = false;
  for (const row of r.data) {
    if ((versions.get(row.id) ?? 0) >= row.version || queue.has(`order:${row.id}`)) continue;
    versions.set(row.id, row.version);
    base.set(row.id, row.data as Order);
    const i = orders.findIndex((o) => o.id === row.id);
    if (i >= 0) orders[i] = row.data as Order; else orders.push(row.data as Order);
    changed = true;
  }
  if (changed) api.replaceDb({ ...d, orders });
}

// ---------- Guardar cambios ----------

/** Llamado por el almacén después de cada cambio local. */
export function queueChanges(prev: DB, next: DB) {
  if (!supabase || state.status !== 'ready') return;
  if (JSON.stringify(catalogOf(prev)) !== JSON.stringify(catalogOf(next))) queue.add('doc:catalog');
  if (JSON.stringify(staffOf(prev)) !== JSON.stringify(staffOf(next))) queue.add('doc:staff');
  const before = new Map(prev.orders.map((o) => [o.id, o]));
  for (const o of next.orders) if (before.get(o.id) !== o) queue.add(`order:${o.id}`);
  if (current && queue.has(current)) dirtyAgain.add(current);
  kick();
}

function kick() {
  setState({ pending: queue.size });
  if (!running && queue.size) void run();
}

async function run() {
  running = true;
  try {
    while (queue.size) {
      const key = queue.values().next().value as string;
      current = key;
      await (key.startsWith('doc:') ? saveDoc(key.slice(4)) : saveOrder(key.slice(6)));
      current = null;
      queue.delete(key);
      if (dirtyAgain.delete(key)) queue.add(key);
      setState({ pending: queue.size, online: true });
    }
  } catch {
    current = null;
    setState({ online: false });
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(kick, 5000);
  } finally {
    running = false;
  }
}

async function saveDoc(id: string) {
  if (!supabase || !api) return;
  const d = api.getDb();
  const data = id === 'catalog' ? catalogOf(d) : staffOf(d);
  const { error } = await supabase.from('app_docs').upsert({ id, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Une cambios hechos al mismo tiempo en dos celulares: gana el campo que cada uno cambió. */
export function mergeOrder(baseO: Order | undefined, local: Order, remote: Order): Order {
  const out = { ...remote } as Record<string, unknown>;
  const b = (baseO ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(local) as (keyof Order)[]) {
    if (JSON.stringify(local[k]) !== JSON.stringify(b[k])) out[k] = local[k];
  }
  const seen = new Set<string>();
  out.history = [...remote.history, ...local.history]
    .filter((h) => { const id = `${h.at}|${h.label}|${h.userId}`; if (seen.has(id)) return false; seen.add(id); return true; })
    .sort((x, y) => x.at - y.at);
  if (local.items.length !== remote.items.length) {
    const ids = new Set<string>();
    out.items = [...remote.items, ...local.items].filter((i) => (ids.has(i.id) ? false : (ids.add(i.id), true)));
  }
  // Si se agregaron platos nuevos, el pedido vuelve a cocina como "Nuevo".
  const maxRound = (o: Order) => Math.max(0, ...o.items.map((i) => i.round));
  if (maxRound(out as unknown as Order) > maxRound(remote) && !remote.closed) {
    out.kitchenStatus = 'enviado';
    out.readyAt = null;
    out.served = false;
    out.sentAt = local.sentAt;
  }
  return out as unknown as Order;
}

function setLocalOrder(o: Order) {
  if (!api) return;
  const d = api.getDb();
  api.replaceDb({ ...d, orders: d.orders.map((x) => (x.id === o.id ? o : x)) });
}

async function saveOrder(id: string) {
  if (!supabase || !api) return;
  let order = api.getDb().orders.find((o) => o.id === id);
  if (!order) return;

  // Número correlativo del local, asignado por el servidor.
  if (!order.number) {
    const r = await supabase.rpc('next_order_number', { p_local: order.localId });
    if (r.error) throw r.error;
    order = { ...api.getDb().orders.find((o) => o.id === id)!, number: r.data as number };
    setLocalOrder(order);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const v = versions.get(id);
    if (v === undefined) {
      const ins = await supabase.from('orders').insert({ id, local_id: order.localId, created_at: new Date(order.createdAt).toISOString(), version: 1, data: order });
      if (!ins.error) { versions.set(id, 1); base.set(id, order); return; }
      if (ins.error.code !== '23505') throw ins.error; // ya existe: seguir como actualización
    } else {
      const up = await supabase.from('orders').update({ data: order, version: v + 1, updated_at: new Date().toISOString() })
        .eq('id', id).eq('version', v).select('version');
      if (up.error) throw up.error;
      if (up.data.length) { versions.set(id, v + 1); base.set(id, order); return; }
    }
    // Otro celular lo cambió antes: traer, unir y reintentar.
    const r = await supabase.from('orders').select('version,data').eq('id', id).single();
    if (r.error) throw r.error;
    order = mergeOrder(base.get(id), api.getDb().orders.find((o) => o.id === id) ?? order, r.data.data as Order);
    versions.set(id, r.data.version);
    base.set(id, r.data.data as Order);
    setLocalOrder(order);
  }
  throw new Error('No se pudo guardar el pedido');
}
