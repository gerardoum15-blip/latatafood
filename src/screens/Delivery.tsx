import { useState } from 'react';
import { createOrder, orderTotal, useDb, useSession } from '../data/store';
import { PAY_LABEL, type Customer, type PayMethod } from '../types';
import { money, orderNo } from '../lib/format';
import { isUrl } from '../lib/whatsapp';
import { LocalPicker, useWorkLocal } from '../components/shared';
import { NewItems, type InitialOrder } from './Waiter';
import { Modal } from '../components/ui';
import { parseOrderMessage } from '../lib/parseOrder';

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
  const [sent, setSent] = useState<{ id: string; name: string; total: number } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [initial, setInitial] = useState<InitialOrder | undefined>(undefined);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importInfo, setImportInfo] = useState<{ count: number; warnings: string[] } | null>(null);

  const importMessage = () => {
    const r = parseOrderMessage(pasteText, db, localId);
    setCustomer({ ...EMPTY, ...r.customer });
    if (r.localId) setLocalId(r.localId);
    if (r.pay) setPay(r.pay);
    setCashWith(r.cashWith ? String(r.cashWith) : '');
    setInitial({ cart: r.cart, picks: r.creamPicks, pkgQty: r.packagingQty, note: [r.pickup ? 'RECOJO EN LOCAL' : '', r.note].filter(Boolean).join(' · ') });
    setFormKey((k) => k + 1);
    setImportInfo({ count: r.cart.reduce((s, i) => s + i.qty, 0), warnings: r.warnings });
    setPasteOpen(false);
    setPasteText('');
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
          <button className="btn primary block" onClick={() => { setSent(null); setInitial(undefined); setImportInfo(null); setFormKey((k) => k + 1); }}>+ Tomar otro pedido</button>
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
        setSent({ id, name: c.name, total: orderTotal({ items, deliveryFee: 0, packagingQty, packagingPrice: db.settings.packagingPrice ?? 0.5 }) });
        setCustomer(EMPTY); setCashWith(''); setPay('efectivo');
      }}
    />
  );
}
