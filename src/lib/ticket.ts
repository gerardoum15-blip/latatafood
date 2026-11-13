import { payInfo } from './rules';
import { driverName } from './drivers';
import type { DB, Order, TicketSettings } from '../types';
import { PAY_LABEL } from '../types';
import { discountTotal, lineTotal, orderTotal, packagingTotal } from '../data/store';
import defaultLogo from '../assets/logo-round.webp';

export const DEFAULT_TICKET: TicketSettings = {
  logo: '',
  title: 'LA TATA FOOD | cocina urbana | SANTA ANITA',
  header: 'R.U.C 10478486966 | RECIBO ELECTRÓNICO • +51955093657\nRestaurante urbano de comida rápida peruana\nTiempo aproximado de espera: 35min',
  footer: '#ArribaPeru 🇵🇪\n#SalvandoteLaCena 💕\n#LaTataFood 🍔🌭🍗🥗🍟',
  showIgv: true,
  igvRate: 18,
};

export const ticketSettings = (db: DB): TicketSettings => ({ ...DEFAULT_TICKET, ...(db.settings.ticket ?? {}) });

const W = 760; // ancho de la imagen (se ve nítida en celular)
const PAD = 36;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const C = { ink: '#2f3640', muted: '#7d848c', faint: '#a7adb3', rule: '#e6e8ea', heavy: '#3a4048', bg: '#ffffff' };

const sol = (n: number) => 'S/ ' + (Math.round(n * 100) / 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

/** Parte un texto en líneas que entren en el ancho dado. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > width && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out;
}

interface Row { qty: string; name: string; sub: string[]; price: string }

/** Dibuja el ticket. Primero mide (draw=false) para saber el alto, luego dibuja. */
export interface TicketOptions { heading?: string; info?: string[] }

async function paint(order: Order, db: DB, t: TicketSettings, logo: HTMLImageElement | null, ctx: CanvasRenderingContext2D, draw: boolean, opt: TicketOptions = {}): Promise<number> {
  const local = db.locales.find((l) => l.id === order.localId);
  const set = (size: number, weight = 400, color = C.ink) => { ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; };
  const text = (s: string, x: number, y: number, align: CanvasTextAlign = 'left') => { if (draw) { ctx.textAlign = align; ctx.fillText(s, x, y); } };
  const rule = (y: number, h = 1, color = C.rule, x0 = PAD, x1 = W - PAD) => { if (draw) { ctx.fillStyle = color; ctx.fillRect(x0, y, x1 - x0, h); } };
  ctx.textBaseline = 'alphabetic';
  let y = PAD;

  // Cabecera: logo + número de recibo
  const logoSize = 120;
  if (logo && draw) {
    ctx.save();
    ctx.beginPath(); ctx.arc(PAD + logoSize / 2, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(logo, PAD, y, logoSize, logoSize);
    ctx.restore();
  }
  set(38, 800, C.heavy); text(opt.heading ?? `RECIBO#${order.number || '—'}`, W - PAD, y + 40, 'right');
  set(22, 400, C.muted); if (local) text(local.name, W - PAD, y + 74, 'right');
  y += (logo ? logoSize : 60) + 36;

  // Título y textos de arriba
  set(25, 700, C.heavy);
  for (const l of wrap(ctx, t.title, W - PAD * 2)) { text(l, PAD, y + 22); y += 32; }
  set(22, 400, C.ink);
  for (const l of wrap(ctx, t.header, W - PAD * 2)) { text(l, PAD, y + 22); y += 30; }
  y += 34;

  // Datos del cliente, entrega y pago (cliente, cocina y driver ven lo mismo)
  const info = opt.info ?? ticketInfo(order, db);
  if (info.length) {
    rule(y, 3, C.heavy); y += 18;
    for (const line of info) {
      const [k, ...rest] = line.split(': ');
      const v = rest.join(': ');
      set(22, 700, C.ink);
      const lines = v ? wrap(ctx, `${k}: ${v}`, W - PAD * 2) : wrap(ctx, k, W - PAD * 2);
      lines.forEach((l, i) => { set(22, i === 0 && v ? 700 : 400, C.ink); text(l, PAD, y + 22); y += 30; });
    }
    y += 16;
  }

  // Filas del pedido
  const rows: Row[] = order.items.map((it) => ({
    qty: `${it.qty}x`,
    name: it.productId.startsWith('extras:') ? it.name : it.name.toUpperCase(),
    sub: [
      ...(it.modifiers.length ? [it.modifiers.map((m) => (m.qty > 1 ? `${m.qty}× ${m.optionName}` : m.optionName)).join(' · ')] : []),
      ...(it.note ? [`Nota: ${it.note}`] : []),
      ...(it.qty > 1 ? [`${sol(it.unitPrice)} c/u`] : []),
      ...(it.discount ? [`Descuento −${sol(it.discount.amount)}${it.discount.percent ? ` (${it.discount.percent}%)` : ''} · ${it.discount.reason}`] : []),
    ],
    price: sol(lineTotal(it)),
  }));
  if (packagingTotal(order) > 0) {
    rows.push({ qty: `${order.packagingQty || 1}x`, name: 'COSTO DE EMPAQUE PARA LLEVAR ♻️', sub: [], price: sol(packagingTotal(order)) });
  }
  const units = rows.reduce((s, r) => s + Number(r.qty.replace('x', '')), 0);
  set(23, 700, C.heavy); text(`${rows.length} items (Ctd.: ${units})`, PAD, y + 22); y += 50;
  rule(y, 3, C.heavy); y += 3;

  const qtyW = 52, priceW = 150;
  const nameX = PAD + qtyW, nameW = W - PAD * 2 - qtyW - priceW - 12;
  for (const r of rows) {
    const top = y + 22;
    set(23, 700, C.ink); const nameLines = wrap(ctx, r.name, nameW);
    set(21, 400, C.faint); const subLines = r.sub.flatMap((s) => wrap(ctx, s, nameW));
    const h = 22 + nameLines.length * 31 + subLines.length * 28 + 20;
    const mid = y + h / 2 + 8;
    set(22, 400, C.muted); text(r.qty, PAD, mid);
    set(23, 700, C.ink); nameLines.forEach((l, i) => text(l, nameX, top + 12 + i * 31));
    set(21, 400, C.faint); subLines.forEach((l, i) => text(l, nameX + 4, top + 12 + nameLines.length * 31 + i * 28));
    set(22, 400, C.muted); text(r.price, W - PAD, top + 10, 'right');
    y += h;
    rule(y);
  }
  y += 28;

  // Totales (los precios ya incluyen IGV: solo se muestra el desglose)
  const total = orderTotal(order);
  const right = (label: string, value: string, size = 22, weight = 400, color = C.muted) => {
    set(size, weight, color); text(`${label}: ${value}`, W - PAD, y + size, 'right'); y += size + 22;
  };
  if (order.deliveryFee) right('Entrega', sol(order.deliveryFee));
  if (order.discount) right(`Descuento${order.discount.percent ? ` ${order.discount.percent}%` : ''}`, `−${sol(order.discount.amount)}`);
  if (discountTotal(order) > 0) right('Ahorraste', sol(discountTotal(order)));
  if (t.showIgv && t.igvRate > 0) {
    const base = Math.round((total / (1 + t.igvRate / 100)) * 100) / 100;
    right('Op. gravada', sol(base));
    right(`IGV (${t.igvRate}%)`, sol(total - base));
  }
  y += 4;
  right('Total', sol(total), 34, 800, C.heavy);
  if (order.payments.length) {
    for (const p of order.payments) right(PAY_LABEL[p.method], sol(p.amount));
  } else if (order.plannedPay) {
    right(PAY_LABEL[order.plannedPay], order.plannedPay === 'pagado' ? 'pagado' : sol(total));
    if (order.cashWith) { right('Paga con', sol(order.cashWith)); right('Vuelto', sol(order.cashWith - total)); }
  }
  y += 10;

  // Pie
  rule(y, 3, C.heavy, 0, W); y += 44;
  set(23, 700, C.ink);
  for (const l of wrap(ctx, t.footer, W - PAD * 2)) { text(l, W / 2, y, 'center'); y += 36; }
  const when = new Date(order.closedAt ?? order.createdAt);
  set(22, 400, C.muted);
  text(`${when.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })} ${when.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })}`, W / 2, y, 'center');
  y += PAD + 10;
  return y;
}

/** Genera el ticket del pedido como imagen PNG. */
export async function renderTicket(order: Order, db: DB, opt: TicketOptions = {}): Promise<Blob> {
  const t = ticketSettings(db);
  const logo = await loadImage(t.logo || defaultLogo);
  const measure = document.createElement('canvas').getContext('2d')!;
  const height = await paint(order, db, t, logo, measure, false, opt);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await paint(order, db, t, logo, ctx, true, opt);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), 'image/png'));
}

/** Achica una imagen subida (logo) para guardarla liviana. */
export async function shrinkImage(file: File, size = 240): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!img) throw new Error('Imagen no válida');
    const s = Math.min(size / img.width, size / img.height, 1);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const webp = c.toDataURL('image/webp', 0.85);
    return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Datos de entrega y pago que van en el ticket (delivery, recojo o InDrive). */
export function ticketInfo(order: Order, db: DB): string[] {
  if (order.channel !== 'delivery' || !order.customer) return [];
  const c = order.customer;
  const L: string[] = [];
  L.push(`Cliente: ${c.name}`);
  if (c.phone) L.push(`WhatsApp: ${c.phone}`);
  if (order.selfDelivery === 'recojo') L.push('Entrega: recojo en local');
  else {
    if (order.selfDelivery === 'indrive') L.push('Entrega: por InDrive');
    if (c.address) L.push(`Dirección: ${c.address}`);
    if (c.reference) L.push(`Referencia: ${c.reference}`);
  }
  const pi = payInfo(db);
  const pay = order.plannedPay;
  if (pay === 'yape') L.push(`Pago: Yape al ${pi.yape}`);
  else if (pay === 'plin') L.push(`Pago: Plin al ${pi.plin}`);
  else if (pay === 'efectivo') L.push(`Pago: efectivo${order.cashWith ? ` (paga con ${sol(order.cashWith)})` : ''}`);
  else if (pay) L.push(`Pago: ${PAY_LABEL[pay]}`);
  if (order.driverId) { const n = driverName(db, order.driverId); if (n) L.push(`Driver: ${n}`); }
  if (order.note) L.push(`Nota: ${order.note}`);
  return L;
}
