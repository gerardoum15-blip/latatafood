import { useEffect, useMemo, useRef, useState } from 'react';
import { addItems, createOrder, nextDriver, orderTotal, setOrderDiscount, useDb, useSession } from '../data/store';
import { PAY_LABEL, type Customer, type PayMethod } from '../types';
import { money, orderNo } from '../lib/format';
import { isUrl, trackUrl, waLink } from '../lib/whatsapp';
import { dateShort, minutesAgo } from '../lib/format';
import { CLOUD, resolveRequest, useRequests, type OrderRequest } from '../data/cloud';
import { beep } from './Kitchen';
import { driverName } from '../lib/drivers';
import { buildCustomers, phoneId, TIER_LABEL } from '../lib/customers';
import { useLocalGeo } from '../lib/useLocalGeo';
import { deliveryFeeFor, kmLabel, maxDeliveryKm, nearestLocal, roadKm } from '../lib/rules';
import { LocalPicker } from '../components/shared';
import { NewItems, type InitialOrder } from './Waiter';
import { Modal } from '../components/ui';
import { TicketButton } from '../components/TicketButton';
import { parseOrderMessage, webOrderToParsed, type ParsedOrder } from '../lib/parseOrder';

const EMPTY: Customer = { name: '', phone: '', address: '', reference: '', mapsUrl: '' };
const METHODS: PayMethod[] = ['efectivo', 'yape', 'plin', 'web', 'tarjeta', 'transferencia', 'pagado'];

/** Mozo delivery: solo toma pedidos (cliente, contacto, ubicación, pago). */
export function DeliveryScreen() {
  const db = useDb();
  const user = useSession()!;
  const fixed = user.role === 'delivery' && !!user.localId;
  /** Solo el mozo delivery confirma o rechaza pedidos de la carta. */
  const canValidate = user.role === 'delivery';
  // El mozo delivery decide en cada pedido qué local lo prepara (según demanda o cercanía).
  const defaultLocal = fixed ? user.localId! : '';
  const [localId, setLocalId] = useState<string>(defaultLocal);
  const priceLocal = localId || db.locales[0]?.id || '';
  const [customer, setCustomer] = useState<Customer>(EMPTY);
  const [pay, setPay] = useState<PayMethod>('efectivo');
  const [cashWith, setCashWith] = useState('');
  const [sent, setSent] = useState<{ id: string; ref: string; name: string; phone: string; total: number; localName: string } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [initial, setInitial] = useState<InitialOrder | undefined>(undefined);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importInfo, setImportInfo] = useState<{ count: number; warnings: string[] } | null>(null);

  const requests = useRequests();
  const pending = requests.filter((r) => r.status === 'pendiente').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const [activeReq, setActiveReq] = useState<OrderRequest | null>(null);
  const [rejecting, setRejecting] = useState<OrderRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const prevPending = useRef(pending.length);
  useEffect(() => {
    if (pending.length > prevPending.current) beep();
    prevPending.current = pending.length;
  }, [pending.length]);

  const [dineIn, setDineIn] = useState<{ table: number | null } | null>(null);
  const [pickup, setPickup] = useState(false);
  const [payOk, setPayOk] = useState(false);

  const applyParsed = (r: ParsedOrder) => {
    setCustomer({ ...EMPTY, ...r.customer });
    setFeeManual(r.deliveryFee != null ? String(r.deliveryFee) : null);
    setIndriveManual(r.indrive ? true : null);
    setDineIn(r.dineIn);
    setPickup(r.pickup);
    setPayOk(false);
    setLocalId(r.localId ?? defaultLocal);
    setLocalManual(false);
    if (r.pay) setPay(r.pay);
    setCashWith(r.cashWith ? String(r.cashWith) : '');
    setInitial({ cart: r.cart, picks: r.creamPicks, pkgAmount: r.packaging, note: [r.pickup ? 'RECOJO EN LOCAL' : '', r.dineIn ? 'COMER EN MESA' : '', r.note].filter(Boolean).join(' · ') });
    setFormKey((k) => k + 1);
    setImportInfo({ count: r.cart.reduce((s, i) => s + i.qty, 0), warnings: r.warnings });
  };

  const importMessage = () => {
    applyParsed(parseOrderMessage(pasteText, db, priceLocal));
    setActiveReq(null);
    setPasteOpen(false);
    setPasteText('');
  };

  const openRequest = (req: OrderRequest) => {
    applyParsed(webOrderToParsed(req.data, db, priceLocal));
    setActiveReq(req);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const local = db.locales.find((l) => l.id === localId);
  const valid = dineIn
    ? !!(customer.name.trim() && dineIn.table)
    : !!(customer.name.trim() && customer.phone.trim() && (customer.address.trim() || isUrl(customer.mapsUrl)) && (!customer.mapsUrl.trim() || isUrl(customer.mapsUrl)));
  const canSend = valid && !!localId && (!activeReq || payOk);
  const turnDriverId = nextDriver(db);
  const turnDriver = turnDriverId ? { name: driverName(db, turnDriverId) } : undefined;

  // Ficha del cliente por su WhatsApp (pedidos anteriores, direcciones guardadas).
  const customers = useMemo(() => buildCustomers(db), [db]);
  const profile = phoneId(customer.phone).length === 9 ? customers.get(phoneId(customer.phone)) : undefined;

  // Costo de delivery sugerido por distancia (si hay ubicación del cliente y del local).
  const point = customer.lat != null && customer.lng != null ? { lat: customer.lat, lng: customer.lng } : null;
  const km = point && local ? roadKm(db, local, point) : null;
  useLocalGeo(db);
  const near = point ? nearestLocal(db, point) : null;
  // Por defecto atiende el local más cercano al cliente (el mozo puede cambiarlo).
  const [localManual, setLocalManual] = useState(false);
  const nearId = near?.local.id;
  useEffect(() => {
    if (nearId && !localManual && !dineIn && !pickup && !fixed) setLocalId(nearId);
  }, [nearId, localManual, dineIn, pickup, fixed]);
  const suggestedFee = km != null ? deliveryFeeFor(db, km) : null;
  const [feeManual, setFeeManual] = useState<string | null>(null);
  // Más allá de la zona (4 km): el envío va por InDrive y lo coordina el mozo delivery o el cliente.
  const [indriveManual, setIndriveManual] = useState<boolean | null>(null);
  const outOfZone = km != null && suggestedFee === null;
  const indrive = !dineIn && !pickup && (indriveManual ?? outOfZone);
  const fee = dineIn || pickup || indrive ? 0 : feeManual !== null ? Number(feeManual) || 0 : suggestedFee ?? 0;

  // Con solo escribir el WhatsApp: se llenan el nombre y la dirección más usada.
  const lastAutofill = useRef('');
  useEffect(() => {
    if (!profile || lastAutofill.current === profile.phone) return;
    lastAutofill.current = profile.phone;
    const a = profile.addresses[0];
    setCustomer((c) => ({
      ...c,
      name: c.name || profile.name,
      ...(!c.address && a ? { address: a.address, mapsUrl: a.mapsUrl, lat: a.lat, lng: a.lng, label: a.label } : {}),
    }));
  }, [profile]);

  if (sent) {
    return (
      <div className="page">
        <div className="card success-box">
          <span aria-hidden style={{ fontSize: '2.4rem' }}>✅</span>
          <b>Pedido {orderNo(db.orders.find((o) => o.id === sent.id) ?? { number: 0 })} enviado a cocina</b>
          <span className="muted">{sent.name} · {money(sent.total)} · {sent.localName}</span>
          {sent.phone && (
            <a className="btn wa block" target="_blank" rel="noreferrer" href={waLink(sent.phone, `Hola ${sent.name.split(' ')[0]}, confirmamos tu pedido ${orderNo(db.orders.find((o) => o.id === sent.id) ?? { number: 0 })} de ${db.settings.businessName}. Total: ${money(sent.total)}${'\n'}Ya lo estamos preparando. Te avisaremos cuando salga el motorizado.${'\n'}Sigue tu pedido aquí: ${trackUrl(sent.ref)}`)}>Confirmar al cliente por WhatsApp</a>
          )}
          {db.orders.find((o) => o.id === sent.id) && <TicketButton order={db.orders.find((o) => o.id === sent.id)!} className="btn block" label="🧾 Ver / enviar ticket" />}
          <button className="btn primary block" onClick={() => { setSent(null); setInitial(undefined); setImportInfo(null); setActiveReq(null); setFormKey((k) => k + 1); }}>+ Tomar otro pedido</button>
        </div>
      </div>
    );
  }

  return (
    <NewItems
      key={formKey}
      initial={initial}
      title="Nuevo pedido delivery"
      localId={priceLocal}
      canSend={canSend}
      sendLabel={!localId ? 'Elige el local que prepara' : !valid ? (dineIn ? 'Falta el número de mesa' : 'Faltan datos del cliente') : !canSend ? 'Valida el pago primero' : 'Enviar a cocina'}
      extra={
        <>
        {CLOUD && (
          <section className="web-inbox" aria-label="Pedidos web por validar">
            <h3>Pedidos web por validar <span className="count">{pending.length}</span></h3>
            <p className="muted small">Ningún pedido de la carta va a cocina sin que el <b>mozo delivery</b> lo revise, valide el pago y lo confirme al cliente por WhatsApp.</p>
            {pending.length === 0 && <p className="muted small">Cuando un cliente pida desde la carta, aparecerá aquí al instante.</p>}
            {pending.map((r) => (
              <article key={r.id} className={activeReq?.id === r.id ? 'card web-req active' : 'card web-req'}>
                <div className="row between wrap"><b>{r.data.customer.name}</b><span className="muted small">hace {minutesAgo(new Date(r.created_at).getTime())} min</span></div>
                <div className="small">{r.data.mode === 'recojo' ? 'Recojo en local' : r.data.customer.address}{r.data.customer.mapsUrl && <> · <a href={r.data.customer.mapsUrl} target="_blank" rel="noreferrer">ver mapa</a></>}</div>
                <div className="muted small">{r.data.items.filter((i) => !i.productId.startsWith('extras:')).map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
                <div className="row between wrap">
                  <b>{money(r.data.total)}</b>
                  {canValidate ? (
                    <div className="row gap">
                      <button className="btn small ghost danger" onClick={() => { setRejecting(r); setRejectReason(''); }}>Rechazar</button>
                      <button className="btn small primary" onClick={() => openRequest(r)}>{activeReq?.id === r.id ? 'Revisando…' : 'Revisar'}</button>
                    </div>
                  ) : <span className="muted small">Lo confirma el mozo delivery</span>}
                </div>
              </article>
            ))}
          </section>
        )}
        {rejecting && (
          <Modal title={`Rechazar pedido de ${rejecting.data.customer.name}`} onClose={() => setRejecting(null)} footer={
            <a className="btn wa block" target="_blank" rel="noreferrer"
              href={waLink(rejecting.data.customer.phone, `Hola ${rejecting.data.customer.name.split(' ')[0]}, lo sentimos: no podemos atender tu pedido en ${db.settings.businessName}${rejectReason.trim() ? ` (${rejectReason.trim()})` : ''}. Escríbenos si deseas cambiar algo.`)}
              onClick={() => { void resolveRequest(rejecting.id, 'rechazado', user.name, { reason: rejectReason.trim() }); if (activeReq?.id === rejecting.id) setActiveReq(null); setRejecting(null); }}>
              Rechazar y avisar por WhatsApp
            </a>
          }>
            <label className="field"><span>Motivo (lo verá el cliente)</span><input id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Ej. fuera de nuestra zona de reparto" /></label>
          </Modal>
        )}
        <button className="btn paste-btn block" onClick={() => setPasteOpen(true)}>📋 Pegar pedido de WhatsApp</button>
        {importInfo && (
          <div className={importInfo.warnings.length ? 'card import-info warn' : 'card import-info'} role="status">
            <b>Se cargaron {importInfo.count} platos del mensaje. Revisa y toca “Enviar a cocina”.</b>
            {importInfo.warnings.length > 0 && <ul>{importInfo.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>
        )}
        {pasteOpen && (
          <Modal title="Pegar pedido de WhatsApp" onClose={() => setPasteOpen(false)} footer={
            <button className="btn primary block" disabled={!pasteText.trim()} onClick={importMessage}>Cargar pedido</button>
          }>
            <p className="muted small">En WhatsApp, mantén presionado el mensaje del cliente → <b>Copiar</b>. Luego pégalo aquí.</p>
            <textarea id="paste-order" rows={12} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="*NUEVO PEDIDO · La Tata Food*&#10;Cliente: …" autoFocus />
          </Modal>
        )}
        {activeReq && (
          <div className="card pay-check">
            <b>1. Validar el pago</b>
            <p className="small muted">
              {pay === 'efectivo'
                ? `Efectivo${cashWith ? `: paga con S/ ${cashWith}. Prepara el vuelto.` : ': confirma con cuánto pagará.'}`
                : `${PAY_LABEL[pay]}: revisa la captura del pago en el WhatsApp ${db.settings.whatsapp}.`}
            </p>
            <label className="check"><input id="pay-ok" type="checkbox" checked={payOk} onChange={(e) => setPayOk(e.target.checked)} /> {pay === 'efectivo' ? 'Monto y vuelto confirmados' : 'Pago verificado (captura recibida)'}</label>
            {dineIn && <p className="small"><b>Comer en mesa</b> · no lleva empaque.</p>}
          </div>
        )}
        <div className="card form-grid">
          {dineIn && (
            <label className="field full"><span>Mesa N° *</span>
              <select id="d-table" value={dineIn.table ?? ''} onChange={(e) => setDineIn({ table: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Elegir mesa</option>
                {Array.from({ length: local?.tables ?? 0 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Mesa {n}</option>)}
              </select>
            </label>
          )}
          {!dineIn && !pickup && !indrive && turnDriver && <p className="full small muted">Driver de turno: <b>{turnDriver.name}</b> (se asigna solo)</p>}
          <div className="full">
            <span className="muted small">Cocina que prepara el pedido</span>
            <LocalPicker value={localId} onChange={(v) => { setLocalId(v); setLocalManual(true); }} fixed={fixed} />
            {!localId && <p className="err-text small">Elige qué local prepara este pedido (según la demanda o la cercanía al cliente).</p>}
            {!localId && customer.mapsUrl && <p className="small"><a href={customer.mapsUrl} target="_blank" rel="noreferrer">Ver la ubicación del cliente en el mapa</a></p>}
          </div>
          <label className="field"><span>Nombre *</span><input id="d-name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
          <label className="field"><span>Contacto (WhatsApp) *</span><input id="d-phone" type="tel" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="987654321" /></label>
          {profile && (
            <div className={`full customer-card tier-${profile.tier}`}>
              <div className="row between wrap">
                <b>{TIER_LABEL[profile.tier]}</b>
                <span className="small">{profile.orders} {profile.orders === 1 ? 'pedido' : 'pedidos'} · {money(profile.spent)} · último {dateShort(profile.last)}</span>
              </div>
              {!customer.name && profile.name && <button className="link small" onClick={() => setCustomer({ ...customer, name: profile.name })}>Usar el nombre "{profile.name}"</button>}
              {profile.addresses.length > 0 && (
                <div className="saved-addr">
                  <span className="muted small">Direcciones guardadas:</span>
                  {profile.addresses.slice(0, 4).map((a) => (
                    <button key={a.address} className={customer.address === a.address ? 'chip active' : 'chip'}
                      onClick={() => { setCustomer({ ...customer, name: customer.name || profile.name, address: a.address, mapsUrl: a.mapsUrl, lat: a.lat, lng: a.lng, label: a.label }); setFeeManual(null); }}>
                      {a.label ? `${a.label}: ` : ''}{a.address.length > 34 ? a.address.slice(0, 34) + '…' : a.address}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <label className="field full"><span>URL de ubicación (Google Maps)</span><input id="d-maps" type="url" value={customer.mapsUrl} onChange={(e) => setCustomer({ ...customer, mapsUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" />{customer.mapsUrl.trim() && !isUrl(customer.mapsUrl) && <span className="err-text small">Debe ser un enlace que empiece con https://</span>}</label>
          <label className="field full"><span>Dirección *</span><input id="d-address" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value, lat: null, lng: null })} placeholder="Calle, número, referencia" /></label>
          {!dineIn && !pickup && (
            <label className="check full"><input id="d-indrive" type="checkbox" checked={indrive} onChange={(e) => setIndriveManual(e.target.checked)} /> 🚗 Envío por InDrive (fuera de zona: lo coordinas tú o el cliente; no se asigna driver)</label>
          )}
          {!dineIn && !pickup && !indrive && (
            <label className="field"><span>Costo de delivery (S/)</span>
              <input id="d-fee" type="number" inputMode="decimal" step="0.5" value={feeManual ?? (suggestedFee ?? '')} placeholder="Según distancia" onChange={(e) => setFeeManual(e.target.value)} />
              <span className="muted small">
                {km != null ? (suggestedFee != null ? `Sugerido ${money(suggestedFee)} · aprox. ${kmLabel(km)} de ${local?.name}` : `Fuera de zona: aprox. ${kmLabel(km)} (más de ${maxDeliveryKm(db)} km)`)
                  : point ? 'Ubica los locales en Ajustes para calcularlo solo.' : 'Sin ubicación del cliente: escríbelo a mano.'}
                {near && local && near.local.id !== local.id ? ` · Más cerca: ${near.local.name} (${kmLabel(near.km)})` : ''}
                {feeManual !== null && suggestedFee != null && <> · <button className="link small" onClick={() => setFeeManual(null)}>usar sugerido</button></>}
              </span>
            </label>
          )}
          <label className="field"><span>Método de pago</span>
            <select id="d-pay" value={pay} onChange={(e) => setPay(e.target.value as PayMethod)}>
              {METHODS.map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
            </select>
          </label>
          {pay === 'efectivo' && (
            <label className="field"><span>¿Con cuánto paga? (S/)</span><input id="d-cash" type="number" inputMode="decimal" value={cashWith} onChange={(e) => setCashWith(e.target.value)} placeholder="Ej. 50" /></label>
          )}
        </div>
        </>
      }
      packaging={!dineIn}
      onSend={(items, note, pkg, discount) => {
        const c = { ...customer, name: customer.name.trim(), phone: customer.phone.trim(), address: customer.address.trim(), mapsUrl: customer.mapsUrl.trim() };
        let id: string;
        if (dineIn && dineIn.table) {
          // Comer en mesa: va a la mesa del local (si ya tiene pedido abierto, se agrega).
          const open = db.orders.find((o) => o.localId === localId && o.channel === 'salon' && !o.closed && o.table === dineIn.table);
          if (open) { addItems(open.id, items, user); if (discount) setOrderDiscount(open.id, open.discount ? { amount: open.discount.amount + discount.amount, reason: `${open.discount.reason} + ${discount.reason}` } : discount, user); id = open.id; }
          else id = createOrder({ localId, channel: 'salon', table: dineIn.table, customer: c.phone ? c : null, deliveryFee: 0, plannedPay: pay, cashWith: null, driverId: null, items, discount, note: [`Pedido web de ${c.name}`, note].filter(Boolean).join(' · ') }, user);
        } else {
          id = createOrder({
            localId, channel: 'delivery', table: null, customer: c, deliveryFee: fee,
            packagingQty: pkg.qty, packagingAmount: pkg.amount,
            plannedPay: pay, cashWith: pay === 'efectivo' && cashWith ? Number(cashWith) : null, driverId: null, items, note: [indrive ? 'ENVÍO POR INDRIVE' : '', note].filter(Boolean).join(' · '), pickup, indrive, discount,
          }, user);
        }
        if (activeReq) void resolveRequest(activeReq.id, 'aceptado', user.name, { order_id: id });
        setSent({ id, ref: activeReq?.id ?? id, name: c.name, phone: c.phone, localName: local?.name ?? '', total: orderTotal({ items, deliveryFee: dineIn ? 0 : fee, packagingAmount: dineIn ? 0 : pkg.amount, discount }) });
        setCustomer(EMPTY); setCashWith(''); setPay('efectivo'); setDineIn(null); setPickup(false); setPayOk(false); setLocalId(defaultLocal); setLocalManual(false); setFeeManual(null); setIndriveManual(null); lastAutofill.current = '';
      }}
    />
  );
}
