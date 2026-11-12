import { useMemo, useState } from 'react';
import { uid, useDb } from '../data/store';
import { PAY_LABEL, type OrderItem, type PayMethod, type Product } from '../types';
import { availableToday, daysLabel, money } from '../lib/format';
import { waLink } from '../lib/whatsapp';
import { LocationPicker, mapsUrlFor, type PickedLocation } from '../components/LocationPicker';
import { CLOUD, submitOrderRequest, type WebOrder } from '../data/cloud';
import { buildCreamItem, CreamPanel, ProductCustomizer, productPrice, type CreamPicks } from '../components/OrderBuilder';
import { ItemLines, Modal } from '../components/ui';
import { suggestPackaging } from './Waiter';
import logo from '../assets/logo.webp';

const KEY = 'pos-restaurante-cliente';
type Client = { name: string; phone: string };

function loadClient(): Client | null {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) as Client : null; } catch { return null; }
}
function saveClient(c: Client | null) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}

/** Carta pública para clientes: sin PIN, solo nombre y WhatsApp. El pedido se envía por WhatsApp. */
export function CustomerApp() {
  const [client, setClient] = useState<Client | null>(loadClient);
  if (!client) return <Welcome onDone={(c) => { saveClient(c); setClient(c); }} />;
  return <CustomerMenu client={client} onChangeClient={() => { saveClient(null); setClient(null); }} />;
}

function Brand() {
  const db = useDb();
  return <h1 className="c-brand"><img src={logo} alt={db.settings.businessName} width={640} height={453} /></h1>;
}

function Welcome({ onDone }: { onDone: (c: Client) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const ok = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 9;
  return (
    <div className="customer">
      <header className="c-hero"><Brand /><p>Carta 2026 · Pide desde tu celular</p></header>
      <form className="c-welcome card" onSubmit={(e) => { e.preventDefault(); if (ok) onDone({ name: name.trim(), phone: phone.trim() }); }}>
        <h2>¡Bienvenido!</h2>
        <p className="muted">Déjanos tu nombre y WhatsApp para preparar tu pedido.</p>
        <label className="field"><span>Tu nombre</span><input id="c-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        <label className="field"><span>Tu WhatsApp</span><input id="c-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="987654321" autoComplete="tel" /></label>
        <button className="btn primary block" type="submit" disabled={!ok}>Ver la carta</button>
      </form>
    </div>
  );
}

function CustomerMenu({ client, onChangeClient }: { client: Client; onChangeClient: () => void }) {
  const db = useDb();
  const cats = [...db.categories].sort((a, b) => a.order - b.order);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [picks, setPicks] = useState<CreamPicks>({});
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'delivery' | 'recojo'>('delivery');
  const [localId, setLocalId] = useState(db.locales[0]?.id ?? '');
  const [address, setAddress] = useState('');
  const [loc, setLoc] = useState<PickedLocation | null>(null);
  const maps = loc ? mapsUrlFor(loc) : '';
  const [sent, setSent] = useState<'ok' | 'wa-only' | null>(null);
  const [pay, setPay] = useState<PayMethod>('efectivo');
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');

  const hasItemGroups = (p: Product) => p.groupIds.some((id) => { const g = db.groups.find((x) => x.id === id); return g && !g.orderLevel; });
  const add = (p: Product) => {
    if (hasItemGroups(p)) { setEditing(p); return; }
    const price = productPrice(p, localId);
    const same = cart.find((i) => i.productId === p.id && i.modifiers.length === 0);
    if (same) setCart(cart.map((i) => (i === same ? { ...i, qty: i.qty + 1 } : i)));
    else setCart([...cart, { id: uid('i'), productId: p.id, name: p.name, basePrice: price, unitPrice: price, qty: 1, modifiers: [], note: '', round: 1 }]);
  };

  const creamItem = buildCreamItem(db, cart, picks);
  const items = creamItem ? [...cart, creamItem] : cart;
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const pkgPrice = db.settings.packagingPrice ?? 0.5;
  const pkgQty = mode === 'delivery' ? suggestPackaging(cart, db) : 0;
  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0) + pkgQty * pkgPrice;
  const local = db.locales.find((l) => l.id === localId);
  const ready = count > 0 && (mode === 'recojo' || !!address.trim());

  const message = useMemo(() => {
    const L: string[] = [];
    L.push(`*NUEVO PEDIDO · ${db.settings.businessName}*`);
    L.push(`Cliente: ${client.name}`);
    L.push(`WhatsApp: ${client.phone}`);
    if (mode === 'delivery') {
      L.push('Entrega: Delivery');
      if (address.trim()) L.push(`Dirección: ${address.trim()}`);
      if (maps) L.push(`Ubicación: ${maps}`);
    } else {
      L.push(`Entrega: Recojo en ${local?.name ?? 'local'}`);
    }
    L.push('');
    for (const it of items) {
      L.push(`${it.qty}× ${it.name} — ${money(it.unitPrice * it.qty)}`);
      for (const m of it.modifiers) L.push(`   · ${m.groupName}: ${m.qty > 1 ? `${m.qty}× ` : ''}${m.optionName}`);
      if (it.note) L.push(`   Nota: ${it.note}`);
    }
    if (pkgQty) L.push(`Empaques: ${pkgQty} × ${money(pkgPrice)} = ${money(pkgQty * pkgPrice)}`);
    L.push('');
    L.push(`*Total: ${money(total)}*${mode === 'delivery' ? ' + delivery según distancia' : ''}`);
    L.push(`Pago: ${PAY_LABEL[pay]}${pay === 'efectivo' && cash ? `, paga con ${money(Number(cash))}` : ''}`);
    if (note.trim()) L.push(`Comentario: ${note.trim()}`);
    return L.join('\n');
  }, [db.settings.businessName, client, mode, address, maps, local, items, pkgQty, pkgPrice, total, pay, cash, note]);

  return (
    <div className="customer">
      <header className="c-hero">
        <Brand />
        <p>Hola, <b>{client.name.split(' ')[0]}</b> 👋 · <button className="c-link" onClick={onChangeClient}>Cambiar mis datos</button></p>
        <ul className="c-notes">
          <li>Tiempo de preparación: 35 minutos máximo.</li>
          <li>Todos los platos son preparados al instante.</li>
          <li>El delivery se cobra según la distancia. El empaque se cobra aparte.</li>
        </ul>
      </header>
      <nav className="c-cats" aria-label="Categorías">
        {cats.filter((c) => db.products.some((p) => p.active && p.categoryId === c.id)).map((c) => (
          <a key={c.id} href={`#cat-${c.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{c.name}</a>
        ))}
      </nav>
      <main className="c-menu">
        {cats.map((c) => {
          const list = db.products.filter((p) => p.active && p.categoryId === c.id);
          if (!list.length) return null;
          return (
            <section key={c.id} id={`cat-${c.id}`} className="c-section">
              <h2>{c.name}</h2>
              <div className="c-grid">
                {list.map((p) => {
                  const inCart = cart.filter((i) => i.productId === p.id).reduce((s, i) => s + i.qty, 0);
                  return (
                    <article key={p.id} className={availableToday(p) ? 'c-item' : 'c-item off'}>
                      <div className="c-item-text">
                        <h3>{p.name}{p.badge && <span className="c-badge">{p.badge}</span>}</h3>
                        {p.description && <p>{p.description}</p>}
                        {p.days?.length ? <p className="c-days">Disponible: {daysLabel(p.days).toLowerCase()}</p> : null}
                      </div>
                      <div className="c-item-foot">
                        <b>{money(productPrice(p, localId))}</b>
                        {availableToday(p)
                          ? <button className="btn primary small" onClick={() => add(p)}>{inCart ? `Agregar otro (${inCart})` : 'Agregar'}</button>
                          : <span className="muted small">No disponible hoy</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      {sent && (
        <Modal title="¡Pedido enviado!" onClose={() => setSent(null)} footer={<button className="btn primary block" onClick={() => setSent(null)}>Volver a la carta</button>}>
          <p>Gracias, {client.name.split(' ')[0]}. Recibimos tu pedido y lo estamos revisando.</p>
          <p className="muted">Te confirmaremos por WhatsApp. Si no se abrió WhatsApp, escríbenos al {db.settings.whatsapp}.</p>
        </Modal>
      )}

      {count > 0 && (
        <div className="c-bar">
          <button className="btn primary block" onClick={() => setOpen(true)}>Ver mi pedido · {count} · {money(total)}</button>
        </div>
      )}

      {editing && (
        <ProductCustomizer product={editing} localId={localId} onClose={() => setEditing(null)} onAdd={(it) => { setCart([...cart, it]); setEditing(null); }} />
      )}

      {open && (
        <Modal title="Mi pedido" onClose={() => setOpen(false)} footer={
          <div className="driver-actions">
            <div className="total-row"><span>Total{mode === 'delivery' ? ' (+ delivery según distancia)' : ''}</span><b>{money(total)}</b></div>
            {ready ? (
              <a className="btn wa big-ok block" href={waLink(db.settings.whatsapp, message)} target="_blank" rel="noreferrer" onClick={() => {
                // Registrar el pedido para que el mozo delivery lo valide (y además se abre WhatsApp con el resumen).
                const data: WebOrder = {
                  v: 1,
                  customer: { name: client.name, phone: client.phone, address: mode === 'delivery' ? address.trim() : `Recojo en ${local?.name ?? 'local'}`, mapsUrl: mode === 'delivery' ? maps : '', lat: mode === 'delivery' ? loc?.lat ?? null : null, lng: mode === 'delivery' ? loc?.lng ?? null : null },
                  mode, localId: mode === 'recojo' ? localId : null, pay, cashWith: pay === 'efectivo' && cash ? Number(cash) : null, note: note.trim(),
                  items: cart, creamPicks: picks, packagingQty: pkgQty, total,
                };
                const ok = CLOUD;
                if (ok) void submitOrderRequest(data);
                setSent(ok ? 'ok' : 'wa-only');
                setOpen(false); setCart([]); setPicks({}); setNote('');
              }}>💬 Enviar pedido</a>
            ) : (
              <button className="btn block" disabled>{count === 0 ? 'Agrega platos' : 'Marca tu ubicación o escribe tu dirección'}</button>
            )}
          </div>
        }>
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
          <CreamPanel cart={cart} picks={picks} setPicks={setPicks} />

          <fieldset className="mod-group">
            <legend>¿Cómo lo recibes?</legend>
            <div className="local-picker">
              <button className={mode === 'delivery' ? 'seg active' : 'seg'} onClick={() => setMode('delivery')}>🛵 Delivery</button>
              <button className={mode === 'recojo' ? 'seg active' : 'seg'} onClick={() => setMode('recojo')}>🏪 Recojo en local</button>
            </div>
            {mode === 'delivery' ? (
              <>
                <LocationPicker value={loc} onChange={setLoc} onAddress={setAddress} />
                <label className="field"><span>Dirección de envío</span><input id="c-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle, número, referencia" /><span className="muted small">Revisa y agrega referencias (piso, color de puerta…).</span></label>
                {pkgQty > 0 && <p className="muted small">Empaques: {pkgQty} × {money(pkgPrice)} = {money(pkgQty * pkgPrice)}</p>}
              </>
            ) : (
              <div className="local-picker">
                {db.locales.map((l) => (
                  <button key={l.id} className={localId === l.id ? 'seg active' : 'seg'} onClick={() => setLocalId(l.id)}>{l.name}</button>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="mod-group">
            <legend>Pago</legend>
            <select id="c-pay" aria-label="Forma de pago" value={pay} onChange={(e) => setPay(e.target.value as PayMethod)}>
              {(['efectivo', 'yape', 'plin', 'tarjeta'] as PayMethod[]).map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
            </select>
            {pay === 'efectivo' && <label className="field"><span>¿Con cuánto pagas? (para tu vuelto)</span><input id="c-cash" type="number" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /></label>}
          </fieldset>
          <label className="field"><span>Comentario para el pedido</span><input id="c-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" /></label>
        </Modal>
      )}
    </div>
  );
}
