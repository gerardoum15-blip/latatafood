import { useMemo, useState } from 'react';
import { uid, useDb } from '../data/store';
import type { DB, ModifierGroup, OrderItem, Product, SelectedModifier } from '../types';
import { availableToday, daysLabel, money } from '../lib/format';
import { ItemLines, Modal } from './ui';
import { DiscountModal } from './DiscountModal';

export const productPrice = (p: Product, localId: string) => p.localPrices[localId] ?? p.price;

/** Unidades gratis de un grupo para un plato de cierto precio. */
export function freeFor(group: ModifierGroup, price: number): number {
  if (group.kind !== 'qty') return 0;
  if (group.freeTiers?.length) {
    const tier = [...group.freeTiers].sort((a, b) => b.min - a.min).find((t) => price >= t.min);
    return tier?.free ?? 0;
  }
  return group.free;
}

/** Calcula el precio de los modificadores elegidos, respetando las unidades gratis. */
function priceMods(group: ModifierGroup, picks: Record<string, number>, free: number): SelectedModifier[] {
  const out: SelectedModifier[] = [];
  let freeLeft = free;
  for (const o of group.options) {
    const q = picks[o.id] ?? 0;
    if (q <= 0) continue;
    const freeUsed = Math.min(freeLeft, q);
    freeLeft -= freeUsed;
    out.push({ groupId: group.id, groupName: group.name, optionId: o.id, optionName: o.name, qty: q, price: (q - freeUsed) * o.price });
  }
  return out;
}

export type CreamPicks = Record<string, Record<string, number>>;

/** Arma un plato con sus opciones elegidas (por id de grupo → id de opción → cantidad). */
export function buildItem(db: DB, product: Product, localId: string, picks: CreamPicks, qty: number, note: string): OrderItem {
  const base = productPrice(product, localId);
  const groups = product.groupIds.map((id) => db.groups.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g && !g.orderLevel);
  const mods = groups.flatMap((g) => priceMods(g, picks[g.id] ?? {}, freeFor(g, base)));
  return { id: uid('i'), productId: product.id, name: product.name, basePrice: base, unitPrice: base + mods.reduce((s, m) => s + m.price, 0), qty, modifiers: mods, note, round: 1 };
}
export const CREAM_ITEM_ID = 'extras:cremas';

const hasItemGroups = (db: DB, p: Product) => p.groupIds.some((id) => { const g = db.groups.find((x) => x.id === id); return g && !g.orderLevel; });

/** Grupos que se eligen al final (cremas, salsas) y cuántas unidades gratis suman los platos del pedido. */
export function orderGroups(db: DB, cart: OrderItem[]): { group: ModifierGroup; free: number }[] {
  const map = new Map<string, { group: ModifierGroup; free: number }>();
  for (const it of cart) {
    const p = db.products.find((x) => x.id === it.productId);
    if (!p) continue;
    for (const gid of p.groupIds) {
      const g = db.groups.find((x) => x.id === gid);
      if (!g?.orderLevel) continue;
      const e = map.get(gid) ?? { group: g, free: 0 };
      e.free += freeFor(g, it.basePrice) * it.qty;
      map.set(gid, e);
    }
  }
  return db.groups.filter((g) => map.has(g.id)).map((g) => map.get(g.id)!);
}

/** Línea "Cremas y salsas" del pedido, con lo que se cobra por encima de lo gratis. */
export function buildCreamItem(db: DB, cart: OrderItem[], picks: CreamPicks): OrderItem | null {
  const mods = orderGroups(db, cart).flatMap(({ group, free }) => priceMods(group, picks[group.id] ?? {}, free));
  if (!mods.length) return null;
  const price = mods.reduce((s, m) => s + m.price, 0);
  return { id: uid('i'), productId: CREAM_ITEM_ID, name: 'Cremas y salsas', basePrice: 0, unitPrice: price, qty: 1, modifiers: mods, note: '', round: 1 };
}

export function CreamPanel({ cart, picks, setPicks }: { cart: OrderItem[]; picks: CreamPicks; setPicks: (p: CreamPicks) => void }) {
  const db = useDb();
  const gs = orderGroups(db, cart);
  if (!gs.length) return null;
  const item = buildCreamItem(db, cart, picks);
  const set = (gid: string, oid: string, v: number) => setPicks({ ...picks, [gid]: { ...(picks[gid] ?? {}), [oid]: Math.max(0, v) } });
  return (
    <div className="cream-panel">
      <h3>Cremas y salsas del pedido</h3>
      <p className="muted small">Se eligen una sola vez para todos los platos.</p>
      {gs.map(({ group, free }) => {
        const used = Object.values(picks[group.id] ?? {}).reduce((s, n) => s + n, 0);
        return (
          <fieldset key={group.id} className="mod-group">
            <legend>
              {group.name}
              {free > 0 && <span className={used > free ? 'pill' : 'pill ok'}>{free} gratis · usadas {Math.min(used, free)}{used > free ? ` · +${used - free} extra` : ''}</span>}
            </legend>
            {group.options.map((o) => {
              const val = picks[group.id]?.[o.id] ?? 0;
              return (
                <div key={o.id} className="mod-opt">
                  <span className="grow">{o.name}{o.price > 0 && <span className="muted"> +{money(o.price)}{free > 0 ? ' c/u extra' : ' c/u'}</span>}</span>
                  <div className="stepper small">
                    <button onClick={() => set(group.id, o.id, val - 1)} disabled={val === 0} aria-label={`Quitar ${o.name}`}>−</button>
                    <span>{val}</span>
                    <button onClick={() => set(group.id, o.id, val + 1)} aria-label={`Agregar ${o.name}`}>+</button>
                  </div>
                </div>
              );
            })}
          </fieldset>
        );
      })}
      {item && item.unitPrice > 0 && <div className="total-row"><span>Cremas y salsas extra</span><b>{money(item.unitPrice)}</b></div>}
    </div>
  );
}

export function ProductCustomizer({ product, localId, onClose, onAdd }: {
  product: Product; localId: string; onClose: () => void; onAdd: (item: OrderItem) => void;
}) {
  const db = useDb();
  const groups = product.groupIds.map((id) => db.groups.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g && !g.orderLevel);
  const [picks, setPicks] = useState<Record<string, Record<string, number>>>(() => Object.fromEntries(
    groups.filter((g) => g.defaultOptionId && g.options.some((o) => o.id === g.defaultOptionId)).map((g) => [g.id, { [g.defaultOptionId!]: 1 }]),
  ));
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const groupCount = (g: ModifierGroup) => Object.values(picks[g.id] ?? {}).reduce((s, n) => s + n, 0);

  const setPick = (g: ModifierGroup, optionId: string, value: number) => {
    setPicks((prev) => {
      const cur = { ...(prev[g.id] ?? {}) };
      if (g.kind === 'single') {
        return { ...prev, [g.id]: { [optionId]: 1 } };
      }
      const next = Math.max(0, value);
      const total = Object.entries(cur).reduce((s, [k, n]) => s + (k === optionId ? 0 : n), 0) + next;
      if (g.max > 0 && total > g.max) return prev;
      cur[optionId] = next;
      return { ...prev, [g.id]: cur };
    });
  };

  const missing = groups.filter((g) => g.required && groupCount(g) === 0);
  const base = productPrice(product, localId);
  const mods = groups.flatMap((g) => priceMods(g, picks[g.id] ?? {}, freeFor(g, base)));
  const unit = base + mods.reduce((s, m) => s + m.price, 0);

  const add = () => {
    setTried(true);
    if (missing.length) return;
    onAdd({ id: uid('i'), productId: product.id, name: product.name, basePrice: base, unitPrice: unit, qty, modifiers: mods, note: note.trim(), round: 1 });
  };

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      footer={
        <div className="row gap">
          <div className="stepper">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} aria-label="Más">+</button>
          </div>
          <button className="btn primary grow" onClick={add}>Agregar · {money(unit * qty)}</button>
        </div>
      }
    >
      <p className="muted">Precio base {money(base)}</p>
      {groups.map((g) => {
        const count = groupCount(g);
        const err = tried && g.required && count === 0;
        return (
          <fieldset key={g.id} className={err ? 'mod-group error' : 'mod-group'}>
            <legend>
              {g.name}
              <span className="pill">{g.required ? 'Obligatorio' : 'Opcional'}</span>
              {g.kind !== 'single' && g.max > 0 && <span className="pill">máx. {g.max}</span>}
              {g.kind === 'qty' && freeFor(g, base) > 0 && <span className="pill ok">{freeFor(g, base)} gratis · usadas {Math.min(count, freeFor(g, base))}</span>}
            </legend>
            {g.options.map((o) => {
              const val = picks[g.id]?.[o.id] ?? 0;
              if (g.kind === 'qty') {
                return (
                  <div key={o.id} className="mod-opt">
                    <span className="grow">{o.name}{o.price > 0 && <span className="muted"> +{money(o.price)}{freeFor(g, base) > 0 ? ' c/u extra' : ' c/u'}</span>}</span>
                    <div className="stepper small">
                      <button onClick={() => setPick(g, o.id, val - 1)} disabled={val === 0} aria-label={`Quitar ${o.name}`}>−</button>
                      <span>{val}</span>
                      <button onClick={() => setPick(g, o.id, val + 1)} aria-label={`Agregar ${o.name}`}>+</button>
                    </div>
                  </div>
                );
              }
              return (
                <label key={o.id} className={val ? 'mod-opt checked' : 'mod-opt'}>
                  <input
                    type={g.kind === 'single' ? 'radio' : 'checkbox'}
                    name={g.id}
                    checked={val > 0}
                    onChange={(e) => setPick(g, o.id, e.target.checked ? 1 : 0)}
                  />
                  <span className="grow">{o.name}</span>
                  {o.price > 0 && <span className="muted">+{money(o.price)}</span>}
                </label>
              );
            })}
            {err && <div className="err-text">Elige una opción</div>}
          </fieldset>
        );
      })}
      <label className="field">
        <span>Nota para cocina</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. bien cocido, sin cebolla…" />
      </label>
    </Modal>
  );
}

/** Plato momentáneo: algo que no está en la carta (nombre y precio libres). */
function CustomItemModal({ onClose, onAdd }: { onClose: () => void; onAdd: (item: OrderItem) => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const valid = name.trim() && Number(price) >= 0 && price !== '';
  return (
    <Modal title="Plato momentáneo" onClose={onClose} footer={
      <div className="row gap">
        <div className="stepper">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">−</button>
          <span>{qty}</span>
          <button onClick={() => setQty((q) => q + 1)} aria-label="Más">+</button>
        </div>
        <button className="btn primary grow" disabled={!valid} onClick={() => {
          const n = name.trim();
          onAdd({ id: uid('i'), productId: `custom:${n.toLowerCase()}`, name: n, basePrice: Number(price), unitPrice: Number(price), qty, modifiers: [], note: note.trim(), round: 1 });
        }}>Agregar · {money((Number(price) || 0) * qty)}</button>
      </div>
    }>
      <p className="muted">Para un plato o pedido especial que no está en la carta.</p>
      <label className="field"><span>Nombre del plato</span><input id="custom-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Media porción de papas" autoFocus /></label>
      <label className="field"><span>Precio (S/)</span><input id="custom-price" type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="field"><span>Observación para cocina</span><input id="custom-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" /></label>
    </Modal>
  );
}

/** Carta ordenada por área + carrito. */
export function OrderBuilder({ localId, cart, setCart, picks, setPicks }: {
  localId: string; cart: OrderItem[]; setCart: (c: OrderItem[]) => void; picks: CreamPicks; setPicks: (p: CreamPicks) => void;
}) {
  const db = useDb();
  const cats = [...db.categories].sort((a, b) => a.order - b.order);
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [custom, setCustom] = useState(false);
  const [discountFor, setDiscountFor] = useState<string | null>(null);
  const discountItem = cart.find((x) => x.id === discountFor) ?? null;

  const list = useMemo(() => db.products.filter((p) => p.active
    && (cat === 'all' || p.categoryId === cat)
    && (!q || p.name.toLowerCase().includes(q.toLowerCase()))), [db.products, cat, q]);

  const addDirect = (p: Product) => {
    if (hasItemGroups(db, p)) { setEditing(p); return; }
    const price = productPrice(p, localId);
    const same = cart.find((i) => i.productId === p.id && i.modifiers.length === 0 && !i.note);
    if (same) setCart(cart.map((i) => (i === same ? { ...i, qty: i.qty + 1 } : i)));
    else setCart([...cart, { id: uid('i'), productId: p.id, name: p.name, basePrice: price, unitPrice: price, qty: 1, modifiers: [], note: '', round: 1 }]);
  };

  const setNote = (it: OrderItem, note: string) => setCart(cart.map((x) => (x === it ? { ...x, note } : x)));

  return (
    <div className="builder">
      <div className="builder-menu">
        <input className="search" id="menu-search" placeholder="Buscar plato o bebida…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          <button className={cat === 'all' ? 'chip active' : 'chip'} onClick={() => setCat('all')}>Toda la carta</button>
          {cats.map((c) => (
            <button key={c.id} className={cat === c.id ? 'chip active' : 'chip'} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
        </div>
        {cats.map((c) => {
          const items = list.filter((p) => p.categoryId === c.id);
          if (!items.length) return null;
          return (
            <section key={c.id} className="menu-section">
              <h3 className="menu-section-title">{c.name}</h3>
              <div className="product-grid">
                {items.map((p) => (
                  <button key={p.id} className="product-card" disabled={!availableToday(p)} onClick={() => addDirect(p)}>
                    <span className="pc-name">{p.name}</span>
                    <span className="pc-price">{money(productPrice(p, localId))}</span>
                    {!availableToday(p) ? <span className="pc-tag">Solo {daysLabel(p.days).toLowerCase()}</span> : hasItemGroups(db, p) && <span className="pc-tag">Personalizable</span>}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {list.length === 0 && <p className="muted">No hay platos con ese nombre.</p>}
        <button className="btn ghost" onClick={() => setCustom(true)}>+ Plato momentáneo (fuera de carta)</button>
      </div>
      <div className="builder-cart">
        <h3>Cuenta ({cart.reduce((s, i) => s + i.qty, 0)})</h3>
        {cart.length === 0 ? <p className="muted">Toca un plato para agregarlo.</p> : (
          <ul className="cart-list">
            {cart.map((it) => (
              <li key={it.id}>
                <ItemLines items={[it]} />
                <input className="note-input" aria-label={`Observación para ${it.name}`} value={it.note} onChange={(e) => setNote(it, e.target.value)} placeholder="Observación (opcional)" />
                <div className="row gap">
                  <div className="stepper small">
                    <button onClick={() => setCart(it.qty <= 1 ? cart.filter((x) => x !== it) : cart.map((x) => (x === it ? { ...x, qty: x.qty - 1 } : x)))} aria-label="Menos">−</button>
                    <span>{it.qty}</span>
                    <button onClick={() => setCart(cart.map((x) => (x === it ? { ...x, qty: x.qty + 1 } : x)))} aria-label="Más">+</button>
                  </div>
                  <button className="btn ghost small danger" onClick={() => setCart(cart.filter((x) => x !== it))}>Quitar</button>
                  <button className="btn ghost small" onClick={() => setDiscountFor(it.id)}>{it.discount ? `Desc. −${money(it.discount.amount)}` : '% Descuento'}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {discountItem && (
          <DiscountModal title={`Descuento: ${discountItem.qty}× ${discountItem.name}`} base={discountItem.unitPrice * discountItem.qty} initial={discountItem.discount}
            onApply={(d) => setCart(cart.map((x) => (x.id === discountItem.id ? { ...x, discount: d } : x)))}
            onRemove={() => setCart(cart.map((x) => (x.id === discountItem.id ? { ...x, discount: undefined } : x)))}
            onClose={() => setDiscountFor(null)} />
        )}
        <CreamPanel cart={cart} picks={picks} setPicks={setPicks} />
      </div>
      {editing && (
        <ProductCustomizer
          product={editing}
          localId={localId}
          onClose={() => setEditing(null)}
          onAdd={(item) => { setCart([...cart, item]); setEditing(null); }}
        />
      )}
      {custom && <CustomItemModal onClose={() => setCustom(false)} onAdd={(item) => { setCart([...cart, item]); setCustom(false); }} />}
    </div>
  );
}
