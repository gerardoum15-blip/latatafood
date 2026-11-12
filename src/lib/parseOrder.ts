import type { Customer, DB, ModifierGroup, OrderItem, PayMethod, Product } from '../types';
import { PAY_LABEL } from '../types';
import { buildCreamItem, buildItem, type CreamPicks } from '../components/OrderBuilder';
import { isUrl } from './whatsapp';
import type { WebOrder } from '../data/cloud';

export interface ParsedOrder {
  customer: Customer;
  pickup: boolean;
  localId: string | null;
  pay: PayMethod | null;
  cashWith: number | null;
  cart: OrderItem[];
  creamPicks: CreamPicks;
  /** Monto de empaques (null = calcular). */
  packaging: number | null;
  /** Pedido para comer en mesa (desde la carta). */
  dineIn: { table: number | null } | null;
  note: string;
  messageTotal: number | null;
  computedTotal: number;
  warnings: string[];
}

/** Para comparar textos sin importar mayúsculas, tildes ni espacios. */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Quita emojis, "�" y asteriscos del inicio de una línea. */
const clean = (s: string) => s.replace(/^[^\p{L}\p{N}·]+/u, '').replace(/\*/g, '').trim();
const num = (s: string) => Number(s.replace(/,/g, ''));

const ITEM_RE = /^(\d+)\s*[×xX]\s+(.+?)\s+[—–-]\s+S\/\s*([\d.,]+)\s*$/;
const MOD_RE = /^\s*·\s*(.+?):\s+(.+)$/;

/**
 * Lee el mensaje que envía la carta de clientes por WhatsApp y lo convierte en un pedido.
 * Los precios se recalculan con la carta actual; lo que no se reconoce se avisa.
 */
export function parseOrderMessage(text: string, db: DB, localId: string): ParsedOrder {
  const warnings: string[] = [];
  const customer: Customer = { name: '', phone: '', address: '', reference: '', mapsUrl: '' };
  let pickup = false;
  let pickLocal: string | null = null;
  let pay: PayMethod | null = null;
  let cashWith: number | null = null;
  let packaging: number | null = null;
  let note = '';
  let messageTotal: number | null = null;
  const creamPicks: CreamPicks = {};
  const cart: OrderItem[] = [];

  type Draft = { product: Product | null; name: string; qty: number; picks: CreamPicks; note: string; cream: boolean };
  const drafts: Draft[] = [];
  let cur: Draft | null = null;

  const findProduct = (name: string) => {
    const n = norm(name);
    return db.products.find((p) => norm(p.name) === n) ?? db.products.find((p) => norm(p.name).startsWith(n) || n.startsWith(norm(p.name))) ?? null;
  };
  const findGroup = (groups: ModifierGroup[], name: string) => groups.find((g) => norm(g.name) === norm(name)) ?? groups.find((g) => norm(g.name).startsWith(norm(name).slice(0, 8)));

  for (const raw of text.replace(/ /g, ' ').split(/\r?\n/)) {
    if (!raw.trim()) continue;

    const item = raw.trim().replace(/\*/g, '').match(ITEM_RE);
    if (item) {
      const name = item[2].trim();
      const cream = norm(name) === 'cremas y salsas';
      cur = { product: cream ? null : findProduct(name), name, qty: Number(item[1]), picks: {}, note: '', cream };
      if (!cream && !cur.product) warnings.push(`No encontré "${name}" en la carta: agrégalo a mano.`);
      drafts.push(cur);
      continue;
    }

    const mod = raw.match(MOD_RE);
    if (mod && cur) {
      const [, gName, optRaw] = mod;
      const qm = optRaw.match(/^(\d+)\s*[×xX]\s+(.+)$/);
      const qty = qm ? Number(qm[1]) : 1;
      const optName = (qm ? qm[2] : optRaw).trim();
      const pool = cur.cream
        ? db.groups.filter((g) => g.orderLevel)
        : (cur.product?.groupIds ?? []).map((id) => db.groups.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g);
      const g = findGroup(pool, gName);
      const o = g?.options.find((x) => norm(x.name) === norm(optName));
      if (!g || !o) {
        if (cur.product || cur.cream) warnings.push(`"${gName}: ${optName}" (${cur.name}) no coincide con la carta: revísalo.`);
        continue;
      }
      const target = cur.cream ? creamPicks : cur.picks;
      target[g.id] = g.kind === 'single' ? { [o.id]: 1 } : { ...(target[g.id] ?? {}), [o.id]: (target[g.id]?.[o.id] ?? 0) + qty };
      continue;
    }

    const line = clean(raw);
    const nota = raw.match(/^\s+(?:Nota|Observación):\s*(.+)$/i);
    if (nota && cur) { cur.note = nota[1].trim(); continue; }

    const kv = line.match(/^([\p{L} ]+?):\s*(.*)$/u);
    const key = kv ? norm(kv[1]) : '';
    const val = kv ? kv[2].trim() : '';

    if (key === 'cliente') customer.name = val;
    else if (key === 'whatsapp' || key === 'celular' || key === 'telefono') customer.phone = val.replace(/[^\d+ ]/g, '').trim();
    else if (key === 'direccion') customer.address = val;
    else if (key === 'ubicacion' || key === 'mapa') { if (isUrl(val)) customer.mapsUrl = val; }
    else if (key === 'delivery') customer.address = customer.address || val; // formato anterior
    else if (key === 'entrega') {
      if (/recojo/i.test(val)) pickup = true;
      const loc = db.locales.find((l) => norm(val).includes(norm(l.name)));
      if (loc) pickLocal = loc.id;
    } else if (key === 'pago') {
      const label = norm(val.split(',')[0]);
      pay = (Object.keys(PAY_LABEL) as PayMethod[]).find((m) => norm(PAY_LABEL[m]) === label || label.startsWith(norm(PAY_LABEL[m]).split(' ')[0])) ?? null;
      const c = val.match(/pag[ao] con S\/\s*([\d.,]+)/i);
      if (c) cashWith = num(c[1]);
    } else if (key === 'empaques') {
      const all = [...val.matchAll(/S\/\s*([\d.,]+)/g)];
      if (all.length) packaging = num(all[all.length - 1][1]);
    } else if (key === 'total') {
      const m = val.match(/S\/\s*([\d.,]+)/);
      if (m) messageTotal = num(m[1]);
    } else if (key === 'comentario') note = val;
    else if (/^recojo en/i.test(line)) { // formato anterior
      pickup = true;
      const loc = db.locales.find((l) => norm(line).includes(norm(l.name)));
      if (loc) pickLocal = loc.id;
    } else if (isUrl(line)) customer.mapsUrl = customer.mapsUrl || line;
    else if (!customer.name && / · /.test(line) && /\d{6,}/.test(line)) { // formato anterior: "Nombre · 999999999"
      const [n, ph] = line.split(' · ');
      customer.name = n.trim();
      customer.phone = ph.replace(/[^\d+ ]/g, '').trim();
    }
  }

  const useLocal = pickLocal ?? localId;
  for (const d of drafts) {
    if (!d.product) continue;
    // Opciones obligatorias que no venían en el mensaje: usar la opción por defecto.
    for (const gid of d.product.groupIds) {
      const g = db.groups.find((x) => x.id === gid);
      if (!g || g.orderLevel || d.picks[gid]) continue;
      if (g.defaultOptionId) d.picks[gid] = { [g.defaultOptionId]: 1 };
      else if (g.required) warnings.push(`Falta elegir "${g.name}" en ${d.product.name}: corrígelo quitándolo y agregándolo de nuevo.`);
    }
    cart.push(buildItem(db, d.product, useLocal, d.picks, d.qty, d.note));
  }
  if (pickup && !customer.address) customer.address = 'Recojo en local';
  if (!customer.name) warnings.push('No encontré el nombre del cliente.');
  if (!customer.phone) warnings.push('No encontré el WhatsApp del cliente.');

  const cream = buildCreamItem(db, cart, creamPicks);
  const computedTotal = [...cart, ...(cream ? [cream] : [])].reduce((s, i) => s + i.unitPrice * i.qty, 0) + (packaging ?? 0);
  if (messageTotal !== null && Math.abs(messageTotal - computedTotal) > 0.009) {
    warnings.push(`El total del mensaje (S/ ${messageTotal.toFixed(2)}) es distinto al de la carta actual (S/ ${computedTotal.toFixed(2)}). Revisa precios y cantidades.`);
  }

  return { customer, pickup, localId: pickLocal, pay, cashWith, cart, creamPicks, packaging, dineIn: null, note, messageTotal, computedTotal, warnings };
}

/**
 * Convierte un pedido web (enviado desde la carta) en un pedido listo para revisar.
 * Los platos se rearman con la carta actual, por si cambió algún precio.
 */
export function webOrderToParsed(data: WebOrder, db: DB, localId: string): ParsedOrder {
  const warnings: string[] = [];
  const useLocal = data.localId ?? localId;
  const cart: OrderItem[] = [];
  for (const it of data.items ?? []) {
    if (it.productId.startsWith('extras:')) continue;
    const product = db.products.find((p) => p.id === it.productId) ?? db.products.find((p) => norm(p.name) === norm(it.name));
    if (!product) { warnings.push(`"${it.name}" ya no está en la carta: agrégalo a mano.`); continue; }
    const picks: CreamPicks = {};
    for (const m of it.modifiers) picks[m.groupId] = { ...(picks[m.groupId] ?? {}), [m.optionId]: m.qty };
    cart.push(buildItem(db, product, useLocal, picks, it.qty, it.note ?? ''));
  }
  const creamPicks: CreamPicks = {};
  for (const [gid, opts] of Object.entries(data.creamPicks ?? {})) if (db.groups.some((g) => g.id === gid)) creamPicks[gid] = opts;
  const cream = buildCreamItem(db, cart, creamPicks);
  const pkg = data.mode === 'mesa' ? 0 : data.packagingAmount ?? (data.packagingQty ?? 0) * (db.settings.packagingPrice ?? 0.5);
  const computedTotal = [...cart, ...(cream ? [cream] : [])].reduce((s, i) => s + i.unitPrice * i.qty, 0) + pkg;
  if (Math.abs((data.total ?? 0) - computedTotal) > 0.009) {
    warnings.push(`El cliente vio un total de S/ ${(data.total ?? 0).toFixed(2)} y con la carta actual es S/ ${computedTotal.toFixed(2)}. Revisa antes de confirmar.`);
  }
  const pay = (Object.keys(PAY_LABEL) as PayMethod[]).includes(data.pay as PayMethod) ? data.pay as PayMethod : null;
  return {
    customer: { name: data.customer.name, phone: data.customer.phone, address: data.customer.address, reference: '', mapsUrl: data.customer.mapsUrl ?? '' },
    pickup: data.mode === 'recojo', localId: data.localId, pay, cashWith: data.cashWith, cart, creamPicks,
    packaging: pkg, dineIn: data.mode === 'mesa' ? { table: data.table ?? null } : null, note: data.note ?? '', messageTotal: data.total, computedTotal, warnings,
  };
}
