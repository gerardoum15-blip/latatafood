import { useEffect, useRef, useState } from 'react';
import { createOrder, orderTotal, useDb, useSession } from '../data/store';
import { PAY_LABEL, type Customer, type PayMethod } from '../types';
import { money, orderNo } from '../lib/format';
import { isUrl, waLink } from '../lib/whatsapp';
import { minutesAgo } from '../lib/format';
import { CLOUD, resolveRequest, useRequests, type OrderRequest } from '../data/cloud';
import { beep } from './Kitchen';
import { LocalPicker, useWorkLocal } from '../components/shared';
import { NewItems, type InitialOrder } from './Waiter';
import { Modal } from '../components/ui';
import { parseOrderMessage, webOrderToParsed, type ParsedOrder } from '../lib/parseOrder';

const EMPTY: Customer = { name: '', phone: '', address: '', reference: '', mapsUrl: '' };
const METHODS: PayMethod[] = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'pagado'];

/** Mozo delivery: solo toma pedidos (cliente, contacto, ubicación, pago). */
export function DeliveryScreen() {
  const db = useDb();
  const user = useSession()!;
  const fixed = user.role === 'delivery' && !!user.localId;
  const [localId, setLocalId] = useWorkLocal(user.role === 'delivery' ? user.localId : null);
  const [customer, setCustomer] = useState<Customer>(EMPTY);
  const [pay, setPay] = useState<PayMethod>('efectivo');
  const [cashWith, setCashWith] = useState('');
  const [sent, setSent] = useState<{ id: string; name: string; phone: string; total: number } | null>(null);
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

  const applyParsed = (r: ParsedOrder) => {
    setCustomer({ ...EMPTY, ...r.customer });
    if (r.localId) setLocalId(r.localId);
    if (r.pay) setPay(r.pay);
    setCashWith(r.cashWith ? String(r.cashWith) : '');
    setInitial({ cart: r.cart, picks: r.creamPicks, pkgQty: r.packagingQty, note: [r.pickup ? 'RECOJO EN LOCAL' : '', r.note].filter(Boolean).join(' · ') });
    setFormKey((k) => k + 1);
    setImportInfo({ count: r.cart.reduce((s, i) => s + i.qty, 0), warnings: r.warnings });
  };

  const importMessage = () => {
    applyParsed(parseOrderMessage(pasteText, db, localId));
    setActiveReq(null);
    setPasteOpen(false);
    setPasteText('');
  };

  const openRequest = (req: OrderRequest) => {
    applyParsed(webOrderToParsed(req.data, db, localId));
    setActiveReq(req);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const local = db.locales.find((l) => l.id === localId);
  const valid = !!(customer.name.trim() && customer.phone.trim() && (customer.address.trim() || isUrl(customer.mapsUrl)) && (!customer.mapsUrl.trim() || isUrl(customer.mapsUrl)));

  if (sent) {
    return (
      <div className="page">
        <div className="card success-box">
          <span aria-hidden style={{ fontSize: '2.4rem' }}>✅</span>
          <b>Pedido {orderNo(db.orders.find((o) => o.id === sent.id) ?? { number: 0 })} enviado a cocina</b>
          <span className="muted">{sent.name} · {money(sent.total)} · {local?.name}</span>
          {sent.phone && (
            <a className="btn wa block" target="_blank" rel="noreferrer" href={waLink(sent.phone, `Hola ${sent.name.split(' ')[0]}, confirmamos tu pedido ${orderNo(db.orders.find((o) => o.id === sent.id) ?? { number: 0 })} de ${db.settings.businessName}. Total: ${money(sent.total)}${'\n'}Ya lo estamos preparando. Te avisaremos cuando salga el motorizado.`)}>Confirmar al cliente por WhatsApp</a>
          )}
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
      localId={localId}
      canSend={valid}
      sendLabel={valid ? 'Enviar a cocina' : 'Faltan datos del cliente'}
      extra={
        <>
        {CLOUD && (
          <section className="web-inbox" aria-label="Pedidos web por validar">
            <h3>Pedidos web por validar <span className="count">{pending.length}</span></h3>
            {pending.length === 0 && <p className="muted small">Cuando un cliente pida desde la carta, aparecerá aquí al instante.</p>}
            {pending.map((r) => (
              <article key={r.id} className={activeReq?.id === r.id ? 'card web-req active' : 'card web-req'}>
                <div className="row between wrap"><b>{r.data.customer.name}</b><span className="muted small">hace {minutesAgo(new Date(r.created_at).getTime())} min</span></div>
                <div className="small">{r.data.mode === 'recojo' ? 'Recojo en local' : r.data.customer.address}{r.data.customer.mapsUrl && <> · <a href={r.data.customer.mapsUrl} target="_blank" rel="noreferrer">ver mapa</a></>}</div>
                <div className="muted small">{r.data.items.filter((i) => !i.productId.startsWith('extras:')).map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
                <div className="row between wrap">
                  <b>{money(r.data.total)}</b>
                  <div className="row gap">
                    <button className="btn small ghost danger" onClick={() => { setRejecting(r); setRejectReason(''); }}>Rechazar</button>
                    <button className="btn small primary" onClick={() => openRequest(r)}>{activeReq?.id === r.id ? 'Revisando…' : 'Revisar'}</button>
                  </div>
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
        <div className="card form-grid">
          <div className="full">
            <span className="muted small">Cocina que prepara el pedido</span>
            <LocalPicker value={localId} onChange={setLocalId} fixed={fixed} />
          </div>
          <label className="field"><span>Nombre *</span><input id="d-name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
          <label className="field"><span>Contacto (WhatsApp) *</span><input id="d-phone" type="tel" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="987654321" /></label>
          <label className="field full"><span>URL de ubicación (Google Maps)</span><input id="d-maps" type="url" value={customer.mapsUrl} onChange={(e) => setCustomer({ ...customer, mapsUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" />{customer.mapsUrl.trim() && !isUrl(customer.mapsUrl) && <span className="err-text small">Debe ser un enlace que empiece con https://</span>}</label>
          <label className="field full"><span>Dirección *</span><input id="d-address" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder="Calle, número, referencia" /></label>
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
      packaging
      onSend={(items, note, packagingQty) => {
        const c = { ...customer, name: customer.name.trim(), phone: customer.phone.trim(), address: customer.address.trim(), mapsUrl: customer.mapsUrl.trim() };
        const input = {
          localId, channel: 'delivery' as const, table: null, customer: c, deliveryFee: 0,
          packagingQty, packagingPrice: db.settings.packagingPrice ?? 0.5,
          plannedPay: pay, cashWith: pay === 'efectivo' && cashWith ? Number(cashWith) : null, driverId: null, items, note,
        };
        const id = createOrder(input, user);
        if (activeReq) void resolveRequest(activeReq.id, 'aceptado', user.name, { order_id: id });
        setSent({ id, name: c.name, phone: c.phone, total: orderTotal({ items, deliveryFee: 0, packagingQty, packagingPrice: db.settings.packagingPrice ?? 0.5 }) });
        setCustomer(EMPTY); setCashWith(''); setPay('efectivo');
      }}
    />
  );
}
