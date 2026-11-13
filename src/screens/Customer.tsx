import { useMemo, useState } from 'react';
import { uid, useDb } from '../data/store';
import { PAY_LABEL, type OrderItem, type PayMethod, type Product } from '../types';
import { availableToday, daysLabel, money } from '../lib/format';
import { waLink } from '../lib/whatsapp';
import { LocationPicker } from '../components/LazyMaps';
import { mapsUrlFor, type PickedLocation } from '../lib/geo';
import { CLOUD, submitOrderRequest, useKitchenQueue, type WebOrder } from '../data/cloud';
import { OrderTracker, rememberTracking, useTracking } from './OrderTracker';
import { buildCreamItem, CreamPanel, ProductCustomizer, productPrice, type CreamPicks } from '../components/OrderBuilder';
import { ItemLines, Modal } from '../components/ui';
import { useLocalGeo } from '../lib/useLocalGeo';
import { deliveryFeeFor, hoursLabel, kmLabel, localAddress, localMapsUrl, maxDeliveryKm, nearestLocal, payInfo, suggestPackaging, waitMinutes } from '../lib/rules';
import logo from '../assets/logo.webp';

const KEY = 'pos-restaurante-cliente';
const ADDR_KEY = 'latatafood-mis-direcciones';
type MyAddress = { label: string; address: string; lat: number | null; lng: number | null };
/** Direcciones del cliente guardadas solo en su celular (casa, oficina…). */
function loadMyAddresses(): MyAddress[] {
  try { return JSON.parse(localStorage.getItem(ADDR_KEY) ?? '[]') as MyAddress[]; } catch { return []; }
}
function saveMyAddress(a: MyAddress): MyAddress[] {
  // Una sola "Casa" y una sola "Oficina" (la nueva reemplaza a la anterior); "Otra" puede haber varias.
  const next = [a, ...loadMyAddresses().filter((x) => x.address !== a.address && (a.label === 'Otra' || x.label !== a.label))].slice(0, 5);
  try { localStorage.setItem(ADDR_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  return next;
}
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
  const [mode, setMode] = useState<'delivery' | 'recojo' | 'mesa'>('delivery');
  const [table, setTable] = useState('');
  const queue = useKitchenQueue();
  const tracking = useTracking();
  const [showTrack, setShowTrack] = useState<string | null>(null);
  const [localId, setLocalId] = useState(db.locales[0]?.id ?? '');
  const [address, setAddress] = useState('');
  const [loc, setLoc] = useState<PickedLocation | null>(null);
  const maps = loc ? mapsUrlFor(loc) : '';
  const [addrLabel, setAddrLabel] = useState('Casa');
  const [myAddrs, setMyAddrs] = useState<MyAddress[]>(loadMyAddresses);
  const [sendErr, setSendErr] = useState('');
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
  const pkg = mode === 'mesa' ? { qty: 0, amount: 0 } : suggestPackaging(cart, db);
  // Delivery: costo según la distancia al local más cercano (si los locales están ubicados).
  useLocalGeo(db);
  const near = mode === 'delivery' && loc ? nearestLocal(db, loc) : null;
  const fee = near ? deliveryFeeFor(db, near.km) : null;
  const outOfZone = !!near && fee === null;
  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0) + pkg.amount + (mode === 'delivery' && fee ? fee : 0);
  const local = db.locales.find((l) => l.id === localId);
  const pi = payInfo(db);
  const tableNo = Number(table);
  const ready = count > 0 && (mode === 'recojo' || (mode === 'mesa' ? tableNo >= 1 : !!address.trim()));
  const wait = waitMinutes(db, queue ?? 0);

  const message = useMemo(() => {
    const L: string[] = [];
    L.push(`*NUEVO PEDIDO · ${db.settings.businessName}*`);
    L.push(`Cliente: ${client.name}`);
    L.push(`WhatsApp: ${client.phone}`);
    if (mode === 'delivery') {
      L.push('Entrega: Delivery');
      if (address.trim()) L.push(`Dirección: ${address.trim()}`);
      if (maps) L.push(`Ubicación: ${maps}`);
      L.push(outOfZone && near ? `Envío: por InDrive (fuera de zona, aprox. ${kmLabel(near.km)})` : fee != null && near ? `Costo de delivery: ${money(fee)} (aprox. ${kmLabel(near.km)})` : 'Costo de delivery: según distancia');
    } else if (mode === 'mesa') {
      L.push(`Entrega: Comer en mesa ${tableNo || '?'} · ${local?.name ?? 'local'}`);
    } else {
      L.push(`Entrega: Recojo en ${local?.name ?? 'local'}`);
    }
    L.push('');
    for (const it of items) {
      L.push(`${it.qty}× ${it.name} — ${money(it.unitPrice * it.qty)}`);
      for (const m of it.modifiers) L.push(`   · ${m.groupName}: ${m.qty > 1 ? `${m.qty}× ` : ''}${m.optionName}`);
      if (it.note) L.push(`   Nota: ${it.note}`);
    }
    if (pkg.amount) L.push(`Empaques: ${pkg.qty} ${pkg.qty === 1 ? 'táper' : 'táperes'} = ${money(pkg.amount)}`);
    L.push('');
    L.push(`*Total: ${money(total)}*${mode === 'delivery' && outOfZone ? ' + envío por InDrive' : mode === 'delivery' && fee == null ? ' + delivery según distancia' : ''}`);
    L.push(`Pago: ${PAY_LABEL[pay]}${pay === 'efectivo' && cash ? `, paga con ${money(Number(cash))}` : ''}`);
    if (pay === 'yape' || pay === 'plin' || pay === 'web') L.push('Envío la captura del pago por este chat.');
    if (note.trim()) L.push(`Comentario: ${note.trim()}`);
    return L.join('\n');
  }, [db.settings.businessName, client, mode, tableNo, address, maps, local, items, pkg, total, pay, cash, note, fee, near]);

  return (
    <div className="customer">
      <header className="c-hero">
        <Brand />
        <p>Hola, <b>{client.name.split(' ')[0]}</b> 👋 · <button className="c-link" onClick={onChangeClient}>Cambiar mis datos</button></p>
        <ul className="c-notes">
          <li>Tiempo de espera aproximado: <b>{wait} min</b>{queue !== null ? ` (${queue} ${queue === 1 ? 'pedido' : 'pedidos'} en cocina)` : ''}.</li>
          <li>Todos los platos son preparados al instante.</li>
          <li>El delivery se cobra según la distancia. El empaque se cobra aparte (no en mesa).</li>
        </ul>
        {tracking[0] && <button className="btn small c-track-btn" onClick={() => setShowTrack(tracking[0].id)}>📦 Ver estado de mi pedido</button>}
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

      {showTrack && <OrderTracker id={showTrack} onClose={() => setShowTrack(null)} />}
      {sendErr && (
        <Modal title="Pedido enviado por WhatsApp" onClose={() => setSendErr('')} footer={<button className="btn primary block" onClick={() => setSendErr('')}>Entendido</button>}>
          <p>Tu pedido se envió por WhatsApp. No pudimos registrarlo en el sistema ({sendErr}), pero lo atenderemos desde el chat.</p>
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
            {mode === 'delivery' && fee != null && near && <div className="total-row"><span>Delivery (aprox. {kmLabel(near.km)})</span><b>{money(fee)}</b></div>}
            {outOfZone && <p className="indrive-note small">🚗 Estás a más de {maxDeliveryKm(db)} km: el envío se hace por <b>InDrive</b> y se paga aparte. Lo coordinamos contigo por WhatsApp (o puedes elegir recojo en local).</p>}
            <div className="total-row"><span>Total{mode === 'delivery' && outOfZone ? ' (+ envío InDrive)' : mode === 'delivery' && fee == null ? ' (+ delivery según distancia)' : ''}</span><b>{money(total)}</b></div>
            <p className="muted small">Al enviar, se abre WhatsApp con tu pedido. Confirmamos cuando validemos el pago.</p>
            {ready ? (
              <a className="btn wa big-ok block" href={waLink(db.settings.whatsapp, message)} target="_blank" rel="noreferrer" onClick={() => {
                // Registrar el pedido para que el mozo delivery lo valide (y además se abre WhatsApp con el resumen).
                const data: WebOrder = {
                  v: 1,
                  deliveryFee: mode === 'delivery' ? fee : null, distanceKm: near?.km ?? null,
                  customer: { label: mode === 'delivery' ? addrLabel : undefined, name: client.name, phone: client.phone, address: mode === 'delivery' ? address.trim() : mode === 'mesa' ? `Mesa ${tableNo} · ${local?.name ?? ''}` : `Recojo en ${local?.name ?? 'local'}`, mapsUrl: mode === 'delivery' ? maps : '', lat: mode === 'delivery' ? loc?.lat ?? null : null, lng: mode === 'delivery' ? loc?.lng ?? null : null },
                  mode, table: mode === 'mesa' ? tableNo : null, localId: mode === 'delivery' ? near?.local.id ?? null : localId, pay, cashWith: pay === 'efectivo' && cash ? Number(cash) : null, note: note.trim(),
                  items: cart, creamPicks: picks, packagingQty: pkg.qty, packagingAmount: pkg.amount, total,
                };
                if (CLOUD) {
                  void submitOrderRequest(data).then((r) => {
                    if (r.id) { rememberTracking(r.id); setShowTrack(r.id); } else setSendErr(r.error ?? 'sin conexión');
                  });
                }
                if (mode === 'delivery' && address.trim()) setMyAddrs(saveMyAddress({ label: addrLabel, address: address.trim(), lat: loc?.lat ?? null, lng: loc?.lng ?? null }));
                setOpen(false); setCart([]); setPicks({}); setNote('');
              }}>💬 Enviar pedido</a>
            ) : (
              <button className="btn block" disabled>{count === 0 ? 'Agrega platos' : mode === 'mesa' ? 'Escribe el número de tu mesa' : 'Marca tu ubicación o escribe tu dirección'}</button>
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
              <button className={mode === 'mesa' ? 'seg active' : 'seg'} onClick={() => setMode('mesa')}>🍽 Comer en mesa</button>
            </div>
            {mode === 'delivery' ? (
              <>
                {myAddrs.length > 0 && (
                  <div className="saved-addr">
                    <span className="muted small">Tus direcciones:</span>
                    {myAddrs.map((a) => (
                      <button key={a.label + a.address} className={address === a.address ? 'chip active' : 'chip'} onClick={() => { setAddress(a.address); setAddrLabel(a.label); setLoc(a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null); }}>
                        {a.label}: {a.address.length > 28 ? a.address.slice(0, 28) + '…' : a.address}
                      </button>
                    ))}
                  </div>
                )}
                <LocationPicker value={loc} onChange={setLoc} onAddress={setAddress} />
                <div className="local-picker" role="radiogroup" aria-label="Guardar esta dirección como">
                  <span className="muted small">Guardar como:</span>
                  {['Casa', 'Oficina', 'Otra'].map((l) => <button key={l} role="radio" aria-checked={addrLabel === l} className={addrLabel === l ? 'seg active' : 'seg'} onClick={() => setAddrLabel(l)}>{l}</button>)}
                </div>
                {near && fee != null && <p className="small fee-note">🛵 Delivery: <b>{money(fee)}</b> · aprox. {kmLabel(near.km)} · te atiende <b>{near.local.name}</b> (el más cercano)</p>}
                <label className="field"><span>Dirección de envío</span><input id="c-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle, número, referencia" /><span className="muted small">Revisa y agrega referencias (piso, color de puerta…).</span></label>
                {pkg.amount > 0 && <p className="muted small">Empaques: {pkg.qty} {pkg.qty === 1 ? 'táper' : 'táperes'} = {money(pkg.amount)}</p>}
              </>
            ) : (
              <>
                <span className="muted small">{mode === 'mesa' ? '¿En qué local estás?' : '¿En qué local recoges?'}</span>
                <div className="local-picker">
                  {db.locales.map((l) => (
                    <button key={l.id} className={localId === l.id ? 'seg active' : 'seg'} onClick={() => setLocalId(l.id)}>{l.name}</button>
                  ))}
                </div>
                {local && <p className="muted small">{localAddress(local)} · {hoursLabel(local)}{localMapsUrl(local) && <> · <a href={localMapsUrl(local)} target="_blank" rel="noreferrer">Ver ubicación</a></>}</p>}
                {mode === 'mesa' && (
                  <label className="field"><span>Número de tu mesa</span><input id="c-table" type="number" inputMode="numeric" min={1} max={local?.tables ?? 99} value={table} onChange={(e) => setTable(e.target.value)} placeholder="Ej. 4" /><span className="muted small">En mesa no se cobra empaque.</span></label>
                )}
                {mode === 'recojo' && pkg.amount > 0 && <p className="muted small">Empaques: {pkg.qty} {pkg.qty === 1 ? 'táper' : 'táperes'} = {money(pkg.amount)}</p>}
              </>
            )}
          </fieldset>

          <fieldset className="mod-group">
            <legend>Pago</legend>
            <div className="pay-options" role="radiogroup" aria-label="Forma de pago">
              {(['yape', 'plin', 'web', 'tarjeta', 'efectivo'] as PayMethod[]).map((m) => (
                <button key={m} role="radio" aria-checked={pay === m} className={pay === m ? 'seg active' : 'seg'} onClick={() => setPay(m)}>{PAY_LABEL[m]}</button>
              ))}
            </div>
            <div className="pay-help small">
              {pay === 'yape' && <p>Yapea <b>{money(total)}</b> al <b>{pi.yape}</b> y envía la captura al WhatsApp <b>{db.settings.whatsapp}</b>.</p>}
              {pay === 'plin' && <p>Plinea <b>{money(total)}</b> al <b>{pi.plin}</b> y envía la captura al WhatsApp <b>{db.settings.whatsapp}</b>.</p>}
              {pay === 'web' && (pi.webUrl
                ? <p>Paga en línea en <a href={pi.webUrl} target="_blank" rel="noreferrer">este enlace</a> y envía la captura al WhatsApp <b>{db.settings.whatsapp}</b>.</p>
                : <p>Te enviaremos el enlace de pago por WhatsApp. Luego envía la captura al <b>{db.settings.whatsapp}</b>.</p>)}
              {pay === 'tarjeta' && <p>{mode === 'delivery' ? 'El motorizado llevará el POS para pagar con tarjeta.' : 'Pagas con tarjeta (POS) en el local.'}</p>}
              {pay === 'efectivo' && <label className="field"><span>¿Con cuánto pagas? (para tu vuelto)</span><input id="c-cash" type="number" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /></label>}
            </div>
          </fieldset>
          <label className="field"><span>Comentario para el pedido</span><input id="c-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" /></label>
        </Modal>
      )}
    </div>
  );
}
