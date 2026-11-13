import type { DB, Local, OrderItem } from '../types';

/** Reglas del negocio que el administrador puede ajustar (con valores por defecto). */
export const DEFAULT_PACKAGING_TIERS = [
  { min: 0, price: 1 },
  { min: 20, price: 2 },
  { min: 40, price: 3 },
  { min: 50, price: 3.5 },
];
export const DEFAULT_PACKAGING_MAX = 3.5;

export const DEFAULT_WAIT_TIERS = [
  { min: 0, minutes: 30 },
  { min: 3, minutes: 45 },
  { min: 6, minutes: 50 },
  { min: 11, minutes: 59 },
];

export const DEFAULT_PAY_INFO = { yape: '955093657', plin: '955093657', webUrl: '' };

const LOCAL_ADDRESS: Record<string, string> = {
  'l-andahuaylas': 'Andahuaylas, Santa Anita',
  'l-praderas': 'Las Praderas 3ra etapa, El Agustino',
};
export const localAddress = (l: Local) => l.address ?? LOCAL_ADDRESS[l.id] ?? '';

const LOCAL_MAPS: Record<string, string> = {
  'l-andahuaylas': 'https://maps.app.goo.gl/hbDLAoTjKRA4HDyL8',
  'l-praderas': 'https://maps.app.goo.gl/nLZRbHarxgXBvNhQA',
};
export const localMapsUrl = (l: Local) => l.mapsUrl ?? LOCAL_MAPS[l.id] ?? '';
export const localOpen = (l: Local) => l.open || '18:00';
export const localClose = (l: Local) => l.close || '23:00';

/** "18:00" -> "6:00 p. m." */
export function hhmmLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
export const hoursLabel = (l: Local) => `${hhmmLabel(localOpen(l))} a ${hhmmLabel(localClose(l))}`;

/** Minutos desde medianoche en hora de Lima. */
function limaMinutes(d = new Date()): number {
  const [h, m] = d.toLocaleTimeString('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  return (h % 24) * 60 + m;
}
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };

/** ¿El local está abierto ahora? (soporta horarios que pasan la medianoche) */
export function isOpenNow(l: Local, d = new Date()): boolean {
  const now = limaMinutes(d), o = toMin(localOpen(l)), c = toMin(localClose(l));
  return o <= c ? now >= o && now < c : now >= o || now < c;
}

export const packagingTiers = (db: DB) => db.settings.packagingTiers?.length ? db.settings.packagingTiers : DEFAULT_PACKAGING_TIERS;
export const packagingMax = (db: DB) => db.settings.packagingMax ?? DEFAULT_PACKAGING_MAX;
export const waitTiers = (db: DB) => db.settings.waitTiers?.length ? db.settings.waitTiers : DEFAULT_WAIT_TIERS;
export const payInfo = (db: DB) => ({ ...DEFAULT_PAY_INFO, ...(db.settings.payInfo ?? {}) });

/** ¿Este plato lleva empaque? (bebidas y adicionales no). */
export function needsPackaging(db: DB, it: OrderItem): boolean {
  if (it.productId.startsWith('extras:')) return false;
  const p = db.products.find((x) => x.id === it.productId);
  const c = db.categories.find((x) => x.id === p?.categoryId);
  return (p?.packaging ?? c?.packaging) !== false;
}

/** Empaque de un plato según su precio, con tope por plato. */
export function packagingFor(db: DB, price: number): number {
  const tier = [...packagingTiers(db)].sort((a, b) => b.min - a.min).find((t) => price >= t.min);
  return Math.min(tier?.price ?? 0, packagingMax(db));
}

/** Empaques sugeridos para un pedido: cantidad de táperes y monto total. */
export function suggestPackaging(items: OrderItem[], db: DB): { qty: number; amount: number } {
  let qty = 0, amount = 0;
  for (const it of items) {
    if (!needsPackaging(db, it)) continue;
    qty += it.qty;
    amount += packagingFor(db, it.unitPrice) * it.qty;
  }
  return { qty, amount: Math.round(amount * 100) / 100 };
}

/** Minutos de espera según pedidos en cocina. */
export function waitMinutes(db: DB, queue: number): number {
  const t = [...waitTiers(db)].sort((a, b) => b.min - a.min).find((x) => queue >= x.min);
  return t?.minutes ?? 30;
}


// ---------- Delivery por distancia ----------
export const DEFAULT_DELIVERY_TIERS = [
  { upTo: 0.3, price: 3 },
  { upTo: 0.9, price: 4 },
  { upTo: 1.5, price: 5 },
  { upTo: 3, price: 8 },
  { upTo: 6, price: 10 },
  { upTo: 8, price: 12 },
];
export const deliveryTiers = (db: DB) => (db.settings.deliveryTiers?.length ? db.settings.deliveryTiers : DEFAULT_DELIVERY_TIERS).slice().sort((a, b) => a.upTo - b.upTo);
export const roadFactor = (db: DB) => db.settings.roadFactor ?? 1.3;
export const maxDeliveryKm = (db: DB) => Math.max(...deliveryTiers(db).map((t) => t.upTo));

/** Distancia en línea recta (km). */
export function straightKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distancia aproximada por calles (km) entre el cliente y un local con coordenadas. */
export function roadKm(db: DB, l: Local, p: { lat: number; lng: number }): number | null {
  if (l.lat == null || l.lng == null) return null;
  return Math.round(straightKm({ lat: l.lat, lng: l.lng }, p) * roadFactor(db) * 100) / 100;
}

/** Costo de delivery para una distancia. null = fuera de zona. */
export function deliveryFeeFor(db: DB, km: number): number | null {
  const t = deliveryTiers(db).find((x) => km <= x.upTo);
  return t ? t.price : null;
}

/** Local más cercano al cliente (solo locales con coordenadas). */
export function nearestLocal(db: DB, p: { lat: number; lng: number }): { local: Local; km: number } | null {
  let best: { local: Local; km: number } | null = null;
  for (const l of db.locales) {
    const km = roadKm(db, l, p);
    if (km != null && (!best || km < best.km)) best = { local: l, km };
  }
  return best;
}

export const kmLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

/** Dirección para buscar cada local en el mapa (la primera vez). */
const LOCAL_GEO_QUERY: Record<string, string> = {
  'l-andahuaylas': 'Ranra Cancha 545, Santa Anita, Lima, Perú',
  'l-praderas': 'Av. Las Praderas 250, El Agustino, Lima, Perú',
};
export const localGeoQuery = (l: Local) => LOCAL_GEO_QUERY[l.id] ?? `${l.address ?? l.name}, Lima, Perú`;

// ---------- Clientes frecuentes ----------
export const DEFAULT_LOYALTY = { frequentMin: 5, frequentPct: 0, vipMin: 15, vipPct: 0 };
export const loyalty = (db: DB) => ({ ...DEFAULT_LOYALTY, ...(db.settings.loyalty ?? {}) });
