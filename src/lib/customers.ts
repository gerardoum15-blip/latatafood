import type { DB, Order } from '../types';
import { orderTotal } from '../data/store';
import { loyalty } from './rules';

/** El número de WhatsApp es la identidad del cliente (últimos 9 dígitos, sin +51 ni espacios). */
export const phoneId = (raw: string | undefined | null) => (raw ?? '').replace(/\D/g, '').slice(-9);

export interface SavedAddress { address: string; mapsUrl: string; lat: number | null; lng: number | null; label: string; uses: number; last: number }

export interface CustomerProfile {
  phone: string;
  name: string;
  orders: number;
  spent: number;
  first: number;
  last: number;
  addresses: SavedAddress[];
  tier: 'nuevo' | 'frecuente' | 'vip';
}

/** Arma la ficha de cada cliente a partir de sus pedidos (no guarda nada aparte). */
export function buildCustomers(db: DB): Map<string, CustomerProfile> {
  const map = new Map<string, CustomerProfile>();
  const L = loyalty(db);
  const sorted = [...db.orders].sort((a, b) => a.createdAt - b.createdAt);
  for (const o of sorted) {
    const id = phoneId(o.customer?.phone);
    if (id.length < 9 || o.cancelled) continue;
    const c = map.get(id) ?? { phone: id, name: '', orders: 0, spent: 0, first: o.createdAt, last: o.createdAt, addresses: [], tier: 'nuevo' as const };
    c.name = o.customer!.name || c.name; // el nombre más reciente
    c.last = o.createdAt;
    if (o.closed) { c.orders++; c.spent += orderTotal(o); }
    const addr = (o.customer!.address ?? '').trim();
    if (addr && !/^recojo|^mesa /i.test(addr)) {
      const key = addr.toLowerCase();
      const found = c.addresses.find((a) => a.address.toLowerCase() === key);
      if (found) {
        found.uses++; found.last = o.createdAt;
        found.mapsUrl = o.customer!.mapsUrl || found.mapsUrl;
        if (o.customer!.lat != null) { found.lat = o.customer!.lat; found.lng = o.customer!.lng ?? null; }
        if (o.customer!.label) found.label = o.customer!.label;
      } else {
        c.addresses.push({ address: addr, mapsUrl: o.customer!.mapsUrl ?? '', lat: o.customer!.lat ?? null, lng: o.customer!.lng ?? null, label: o.customer!.label ?? '', uses: 1, last: o.createdAt });
      }
    }
    map.set(id, c);
  }
  for (const c of map.values()) {
    c.addresses.sort((a, b) => b.uses - a.uses || b.last - a.last);
    c.tier = c.orders >= L.vipMin ? 'vip' : c.orders >= L.frequentMin ? 'frecuente' : 'nuevo';
  }
  return map;
}

export const TIER_LABEL: Record<CustomerProfile['tier'], string> = { nuevo: 'Cliente nuevo', frecuente: '⭐ Cliente frecuente', vip: '👑 Cliente VIP' };

export const lastOrderOf = (db: DB, phone: string): Order | undefined =>
  [...db.orders].filter((o) => phoneId(o.customer?.phone) === phone).sort((a, b) => b.createdAt - a.createdAt)[0];
