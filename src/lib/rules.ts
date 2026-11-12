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
