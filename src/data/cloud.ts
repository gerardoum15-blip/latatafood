import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useState, useSyncExternalStore } from 'react';
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

/**
 * checking: iniciando · signed-out: falta la clave del local (modo antiguo) · need-pin: falta ingresar un PIN
 * loading: cargando datos · ready: listo · error: no se pudo cargar
 */
export type CloudStatus = 'checking' | 'signed-out' | 'need-pin' | 'loading' | 'ready' | 'error';
interface CloudState { status: CloudStatus; catalogReady: boolean; online: boolean; pending: number; error: string; pinServer: boolean }
let state: CloudState = { status: CLOUD ? 'checking' : 'ready', catalogReady: !CLOUD, online: true, pending: 0, error: '', pinServer: false };
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
  setUser: (id: string | null) => void;
}
let api: StoreApi | null = null;

type Catalog = Pick<DB, 'settings' | 'locales' | 'categories' | 'groups' | 'products'>;
type Staff = Pick<DB, 'users'>;
const catalogOf = (d: DB): Catalog => ({ settings: d.settings, locales: d.locales, categories: d.categories, groups: d.groups, products: d.products });
/** Con el ingreso por PIN, los PIN viven cifrados en el servidor y nunca se guardan en la lista visible. */
const staffOf = (d: DB): Staff => ({ users: state.pinServer ? d.users.map(({ pin: _pin, ...u }) => ({ ...u, pin: '' })) : d.users });

/** Última versión confirmada por el servidor de cada pedido (para unir cambios simultáneos). */
const versions = new Map<string, number>();
const base = new Map<string, Order>();
const queue = new Set<string>(); // 'doc:catalog' | 'doc:staff' | 'order:<id>'
let running = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let channel: RealtimeChannel | null = null;
let current: string | null = null;
const dirtyAgain = new Set<string>();

// ---------- Cambios pendientes guardados en el celular ----------
// Si el celular se queda sin internet y la app se cierra, los cambios no se pierden:
// quedan aquí y se envían al volver la conexión.
const PENDING_KEY = 'latatafood-pendientes';
type Pending = { keys: string[]; bases: Record<string, Order> };
function readPending(): Pending {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '') as Pending; } catch { return { keys: [], bases: {} }; }
}
function savePending() {
  const keys = [...queue];
  const bases: Record<string, Order> = {};
  for (const k of keys) if (k.startsWith('order:') && base.has(k.slice(6))) bases[k.slice(6)] = base.get(k.slice(6))!;
  try {
    if (keys.length) localStorage.setItem(PENDING_KEY, JSON.stringify({ keys, bases }));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* sin almacenamiento */ }
}
/** Pendientes de una sesión anterior (se recuperan una sola vez al cargar). */
let restored: Pending | null = typeof window !== 'undefined' ? readPending() : null;

// ---------- Inicio ----------

export async function startCloud(storeApi: StoreApi) {
  api = storeApi;
  if (!supabase) return;
  loadCatalog();
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { channel?.unsubscribe(); channel = null; void resolveAccess(); }
  });
  await resolveAccess();
  window.addEventListener('online', () => { setState({ online: true }); kick(); });
  window.addEventListener('offline', () => setState({ online: false }));
}

const isEmailStaff = async () => (await supabase!.auth.getSession()).data.session?.user.email === STAFF_EMAIL;

/**
 * Decide qué necesita este celular: si ya ingresó con PIN, carga todo; si no, pide el PIN.
 * Cada celular usa una sesión anónima de Supabase; el PIN la convierte en sesión del personal.
 */
async function resolveAccess() {
  if (!supabase || !api) return;
  setState({ status: 'checking', error: '' });
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const r = await supabase.auth.signInAnonymously();
    if (r.error) {
      setState({ status: 'error', pinServer: false, error: `Supabase no permitió el ingreso con código (${r.error.message}). En Supabase > Authentication > Sign In / Providers activa "Allow new users to sign up" y "Allow anonymous sign-ins", guarda y recarga.` });
      return;
    }
    session = r.data.session;
  }
  const r = await supabase.rpc('my_staff_user');
  const email = session?.user.email === STAFF_EMAIL;
  if (r.error) {
    if (r.error.code === 'PGRST202' || /could not find the function/i.test(r.error.message)) {
      // Modo antiguo (falta ejecutar 02-ingreso-con-pin.sql): clave del local + PIN guardado en la lista.
      setState({ pinServer: false });
      if (email) await loadAll();
      else setState({ status: 'error', error: 'Falta un paso en Supabase: ejecuta el archivo 02-ingreso-con-pin.sql en el SQL Editor y recarga.' });
      return;
    }
    setState({ status: 'error', error: describeError(r.error) });
    return;
  }
  setState({ pinServer: true });
  if (r.data) { await loadAll(); api.setUser(r.data as string); return; }
  if (email) { await loadAll(); return; }
  setState({ status: 'need-pin' });
}

/** Ingresar con PIN (validado en el servidor). */
export async function staffLogin(pin: string): Promise<{ userId?: string; error?: string }> {
  if (!supabase) return { error: 'Sin conexión' };
  const r = await supabase.rpc('staff_login', { p_pin: pin });
  if (r.error) return { error: /Demasiados/.test(r.error.message) ? r.error.message : describeError(r.error) };
  if (!r.data) return { error: 'PIN incorrecto' };
  if (state.status !== 'ready') await loadAll();
  return { userId: r.data as string };
}

/** Salir: este celular pierde el acceso hasta que se ingrese otro PIN. */
export async function staffLogout() {
  if (!supabase || !state.pinServer) return;
  await supabase.rpc('staff_logout');
  if (!(await isEmailStaff())) {
    channel?.unsubscribe();
    channel = null;
    setState({ status: 'need-pin' });
  }
}

/** Crear o cambiar PIN, función o estado de un usuario. Devuelve un mensaje de error o null. */
export async function setStaffPin(userId: string, pin: string, role: string, active: boolean): Promise<string | null> {
  if (!supabase) return null;
  const r = await supabase.rpc('set_staff_pin', { p_user: userId, p_pin: pin, p_role: role, p_active: active });
  return r.error ? r.error.message : null;
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

    // Recuperar cambios que quedaron sin enviar (por ejemplo, la app se cerró sin internet).
    let useLocalCatalog = false, useLocalStaff = false;
    if (restored?.keys.length) {
      for (const key of restored.keys) {
        if (key === 'doc:catalog') useLocalCatalog = true;
        if (key === 'doc:staff') useLocalStaff = true;
        if (key.startsWith('order:')) {
          const id = key.slice(6);
          const mine = local.orders.find((o) => o.id === id);
          if (!mine) continue;
          const i = orders.findIndex((o) => o.id === id);
          if (i >= 0) orders[i] = mergeOrder(restored.bases[id] ?? orders[i], mine, orders[i]);
          else orders.push(mine);
        }
        queue.add(key);
      }
    }
    restored = null;
    api.replaceDb({ ...local, ...(useLocalCatalog ? catalogOf(local) : catalog ?? catalogOf(local)), ...(useLocalStaff ? staffOf(local) : staff ?? staffOf(local)), orders });
    // Primera vez: subir la carta y los usuarios iniciales.
    if (!catalog) queue.add('doc:catalog');
    if (!staff) {
      queue.add('doc:staff');
      if (state.pinServer) for (const u of local.users) if (u.pin) await setStaffPin(u.id, u.pin, u.role, u.active);
    }
    subscribeRealtime();
    void loadRequests();
    void loadDriverLocations();
    setState({ status: 'ready', catalogReady: true });
    kick();
  } catch (e) {
    setState({ status: 'error', error: describeError(e) });
  }
}

export function retryLoad() { void resolveAccess(); }

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
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, (p) => {
      const id = (p.old as { id?: string })?.id;
      if (!id || !api) return;
      const d = api.getDb();
      if (d.orders.some((o) => o.id === id)) api.replaceDb({ ...d, orders: d.orders.filter((o) => o.id !== id) });
    })
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (p) => {
      const row = p.new as DriverLocation;
      if (row?.user_id) upsertDriverLocation(row);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_requests' }, (p) => {
      const row = p.new as OrderRequest;
      if (row?.id) upsertRequest(row);
    })
    .subscribe((status) => {
      // Al reconectar, recargar para no perder cambios hechos mientras no había señal.
      if (status === 'SUBSCRIBED' && state.status === 'ready') { refreshOrders(); void loadRequests(); }
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
  savePending();
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
      savePending();
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

// ---------- Pedidos web (enviados por clientes desde la carta) ----------

export interface OrderRequest {
  id: string;
  created_at: string;
  status: 'pendiente' | 'aceptado' | 'rechazado';
  data: WebOrder;
  handled_by: string | null;
  order_id: string | null;
  reason: string | null;
}

/** Lo que envía la carta del cliente. */
export interface WebOrder {
  v: 1;
  customer: { name: string; phone: string; address: string; mapsUrl: string; lat: number | null; lng: number | null; label?: string };
  /** Costo de delivery calculado por distancia (si se pudo) y distancia aproximada en km. */
  deliveryFee?: number | null;
  distanceKm?: number | null;
  mode: 'delivery' | 'recojo' | 'mesa';
  /** Comer en mesa: número de mesa. */
  table?: number | null;
  localId: string | null;
  pay: string;
  cashWith: number | null;
  note: string;
  items: Order['items'];
  creamPicks: Record<string, Record<string, number>>;
  packagingQty: number;
  packagingAmount?: number;
  /** Id que devuelve el servidor (para seguir el estado). */
  requestId?: string;
  total: number;
}

let requests: OrderRequest[] = [];
const reqListeners = new Set<() => void>();
const setRequests = (next: OrderRequest[]) => { requests = next; reqListeners.forEach((l) => l()); };
export function useRequests(): OrderRequest[] {
  return useSyncExternalStore((l) => { reqListeners.add(l); return () => { reqListeners.delete(l); }; }, () => requests, () => requests);
}

/** Cliente: registra el pedido para que el mozo delivery lo valide. */
export async function submitOrderRequest(data: WebOrder): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: 'Sin conexión' };
  const r = await supabase.rpc('submit_order_request', { p_data: data });
  return r.error ? { error: r.error.message } : { id: r.data as string };
}

/** Estado de un pedido web (para el cliente). */
export interface RequestStatus {
  status: 'pendiente' | 'aceptado' | 'rechazado'; reason: string | null; mode: string | null; number: number | null;
  kitchen: string | null; delivery: string | null; served: boolean; closed: boolean; cancelled: boolean; driver: string | null;
}
export async function fetchRequestStatus(id: string): Promise<RequestStatus | null> {
  if (!supabase) return null;
  const r = await supabase.rpc('order_request_status', { p_id: id });
  return r.error ? null : (r.data as RequestStatus | null);
}

/** Pedidos en cocina ahora (para estimar el tiempo de espera). null = no disponible. */
export function useKitchenQueue(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const load = async () => {
      const r = await supabase!.rpc('kitchen_queue');
      if (alive && !r.error) setN(r.data as number);
    };
    void load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return n;
}

/** Borrar un pedido de la base de datos (solo administrador). */
export async function deleteOrderCloud(id: string) {
  if (!supabase) return;
  queue.delete(`order:${id}`);
  versions.delete(id);
  base.delete(id);
  await supabase.from('orders').delete().eq('id', id);
}

export async function loadRequests() {
  if (!supabase) return;
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const r = await supabase.from('order_requests').select('id,created_at,status,data,handled_by,order_id,reason').gte('created_at', since).order('created_at', { ascending: false });
  if (!r.error) setRequests(r.data as OrderRequest[]); // si falta la tabla (03-pedidos-web.sql), se ignora
}

function upsertRequest(row: OrderRequest) {
  const i = requests.findIndex((x) => x.id === row.id);
  const next = requests.slice();
  if (i >= 0) next[i] = { ...next[i], ...row }; else next.unshift(row);
  setRequests(next);
}

export async function resolveRequest(id: string, status: 'aceptado' | 'rechazado', by: string, extra: { order_id?: string; reason?: string }) {
  if (!supabase) return;
  const patch = { status, handled_by: by, handled_at: new Date().toISOString(), ...extra };
  const cur = requests.find((x) => x.id === id);
  if (cur) upsertRequest({ ...cur, ...patch } as OrderRequest);
  await supabase.from('order_requests').update(patch).eq('id', id);
}

// ---------- Ubicación de drivers ----------

export interface DriverLocation { user_id: string; lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; updated_at: string }

let locations: DriverLocation[] = [];
const locListeners = new Set<() => void>();
const setLocations = (next: DriverLocation[]) => { locations = next; locListeners.forEach((l) => l()); };
export function useDriverLocations(): DriverLocation[] {
  return useSyncExternalStore((l) => { locListeners.add(l); return () => { locListeners.delete(l); }; }, () => locations, () => locations);
}
export async function loadDriverLocations() {
  if (!supabase) return;
  const r = await supabase.from('driver_locations').select('*');
  if (!r.error) setLocations(r.data as DriverLocation[]); // si falta la tabla (05-ubicacion-drivers.sql), se ignora
}
export function upsertDriverLocation(row: DriverLocation) {
  const i = locations.findIndex((x) => x.user_id === row.user_id);
  const next = locations.slice();
  if (i >= 0) next[i] = row; else next.push(row);
  setLocations(next);
}

/** El celular del driver envía su ubicación. Devuelve un error o null. */
export async function sendMyLocation(c: GeolocationCoordinates, driverId?: string | null): Promise<string | null> {
  if (!supabase) return null;
  const args = { p_lat: c.latitude, p_lng: c.longitude, p_accuracy: c.accuracy ?? null, p_heading: c.heading ?? null, p_speed: c.speed ?? null };
  // Con un solo usuario de drivers, la ubicación se guarda a nombre de quien maneja (08-drivers.sql).
  const r = driverId ? await supabase.rpc('update_my_location', { ...args, p_driver: driverId }) : await supabase.rpc('update_my_location', args);
  if (r.error && driverId && (r.error.code === 'PGRST202' || /could not find/i.test(r.error.message))) {
    const old = await supabase.rpc('update_my_location', args);
    return old.error ? old.error.message : null;
  }
  return r.error ? r.error.message : null;
}

/** Seguimiento para el cliente (código del pedido web o del pedido). Incluye la ubicación del driver si está en camino. */
export async function trackOrder(ref: string): Promise<(RequestStatus & { location: { lat: number; lng: number; updated_at: string } | null }) | null> {
  if (!supabase) return null;
  const r = await supabase.rpc('track_order', { p_ref: ref });
  if (!r.error) return r.data;
  const old = await fetchRequestStatus(ref); // sin 05-ubicacion-drivers.sql
  return old ? { ...old, location: null } : null;
}

// ---------- Seguridad y respaldo (administrador) ----------

export interface SecuritySummary { failed_24h: number; failed_1h: number; devices: number; orders: number; db_size_mb: number }
export async function fetchSecuritySummary(): Promise<SecuritySummary | null> {
  if (!supabase) return null;
  const r = await supabase.rpc('security_summary');
  return r.error ? null : (r.data as SecuritySummary);
}
export async function logoutAllDevices(): Promise<{ n?: number; error?: string }> {
  if (!supabase) return { error: 'Sin conexión' };
  const r = await supabase.rpc('staff_logout_all');
  return r.error ? { error: r.error.message } : { n: r.data as number };
}

/** Respaldo completo: carta, usuarios (sin códigos), pedidos y pedidos web, en un archivo JSON. */
export async function downloadBackup(db: DB) {
  const all: Order[] = [];
  if (supabase && state.status === 'ready') {
    for (let from = 0; ; from += 1000) {
      const r = await supabase.from('orders').select('data').order('created_at').range(from, from + 999);
      if (r.error) break;
      all.push(...r.data.map((x) => x.data as Order));
      if (r.data.length < 1000) break;
    }
  }
  const reqs = supabase ? (await supabase.from('order_requests').select('*').order('created_at')).data ?? [] : [];
  const backup = {
    app: 'La Tata Food', exportedAt: new Date().toISOString(),
    catalog: catalogOf(db), users: db.users.map(({ pin: _p, ...u }) => u),
    orders: all.length ? all : db.orders, orderRequests: reqs,
  };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `latatafood-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return backup.orders.length;
}
