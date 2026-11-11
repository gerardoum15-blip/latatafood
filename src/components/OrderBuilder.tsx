import { useMemo, useState } from 'react';
import { uid, useDb } from '../data/store';
import type { ModifierGroup, OrderItem, Product, SelectedModifier } from '../types';
import { money } from '../lib/format';
import { ItemLines, Modal } from './ui';

export const productPrice = (p: Product, localId: string) => p.localPrices[localId] ?? p.price;

/** Calcula el precio de los modificadores elegidos, respetando las unidades gratis. */
function priceMods(group: ModifierGroup, picks: Record<string, number>): SelectedModifier[] {
  const out: SelectedModifier[] = [];
  let freeLeft = group.kind === 'qty' ? group.free : 0;
  for (const o of group.options) {
    const q = picks[o.id] ?? 0;
    if (q <= 0) continue;
    const freeUsed = Math.min(freeLeft, q);
    freeLeft -= freeUsed;
    out.push({ groupId: group.id, groupName: group.name, optionId: o.id, optionName: o.name, qty: q, price: (q - freeUsed) * o.price });
  }
  return out;
}

export function ProductCustomizer({ product, localId, onClose, onAdd }: {
  product: Product; localId: string; onClose: () => void; onAdd: (item: OrderItem) => void;
}) {
  const db = useDb();
  const groups = product.groupIds.map((id) => db.groups.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g);
  const [picks, setPicks] = useState<Record<string, Record<string, number>>>({});
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
  const mods = groups.flatMap((g) => priceMods(g, picks[g.id] ?? {}));
  const base = productPrice(product, localId);
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
              {g.kind === 'qty' && g.free > 0 && <span className="pill ok">{g.free} gratis</span>}
            </legend>
            {g.options.map((o) => {
              const val = picks[g.id]?.[o.id] ?? 0;
              if (g.kind === 'qty') {
                return (
                  <div key={o.id} className="mod-opt">
                    <span className="grow">{o.name}{o.price > 0 && <span className="muted"> +{money(o.price)} c/u extra</span>}</span>
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

/** Carta para elegir productos + carrito. */
export function OrderBuilder({ localId, cart, setCart }: { localId: string; cart: OrderItem[]; setCart: (c: OrderItem[]) => void }) {
  const db = useDb();
  const cats = [...db.categories].sort((a, b) => a.order - b.order);
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);

  const list = useMemo(() => db.products.filter((p) => p.active
    && (cat === 'all' || p.categoryId === cat)
    && (!q || p.name.toLowerCase().includes(q.toLowerCase()))), [db.products, cat, q]);

  const addDirect = (p: Product) => {
    if (p.groupIds.length) { setEditing(p); return; }
    const price = productPrice(p, localId);
    const same = cart.find((i) => i.productId === p.id && i.modifiers.length === 0 && !i.note);
    if (same) setCart(cart.map((i) => (i === same ? { ...i, qty: i.qty + 1 } : i)));
    else setCart([...cart, { id: uid('i'), productId: p.id, name: p.name, basePrice: price, unitPrice: price, qty: 1, modifiers: [], note: '', round: 1 }]);
  };

  return (
    <div className="builder">
      <div className="builder-menu">
        <input className="search" placeholder="Buscar plato o bebida…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          <button className={cat === 'all' ? 'chip active' : 'chip'} onClick={() => setCat('all')}>Todo</button>
          {cats.map((c) => (
            <button key={c.id} className={cat === c.id ? 'chip active' : 'chip'} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
        </div>
        <div className="product-grid">
          {list.map((p) => (
            <button key={p.id} className="product-card" onClick={() => addDirect(p)}>
              <span className="pc-name">{p.name}</span>
              <span className="pc-price">{money(productPrice(p, localId))}</span>
              {p.groupIds.length > 0 && <span className="pc-tag">Personalizable</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="builder-cart">
        <h3>Pedido ({cart.reduce((s, i) => s + i.qty, 0)})</h3>
        {cart.length === 0 ? <p className="muted">Toca un plato para agregarlo.</p> : (
          <ul className="cart-list">
            {cart.map((it) => (
              <li key={it.id}>
                <ItemLines items={[it]} />
                <div className="row gap">
                  <div className="stepper small">
                    <button onClick={() => setCart(it.qty <= 1 ? cart.filter((x) => x !== it) : cart.map((x) => (x === it ? { ...x, qty: x.qty - 1 } : x)))} aria-label="Menos">−</button>
                    <span>{it.qty}</span>
                    <button onClick={() => setCart(cart.map((x) => (x === it ? { ...x, qty: x.qty + 1 } : x)))} aria-label="Más">+</button>
                  </div>
                  <button className="btn ghost small danger" onClick={() => setCart(cart.filter((x) => x !== it))}>Quitar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <ProductCustomizer
          product={editing}
          localId={localId}
          onClose={() => setEditing(null)}
          onAdd={(item) => { setCart([...cart, item]); setEditing(null); }}
        />
      )}
    </div>
  );
}
