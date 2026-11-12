import { useState } from 'react';
import { createOrder, orderTotal, useDb, useSession } from '../data/store';
import { PAY_LABEL, type Customer, type PayMethod } from '../types';
import { money, orderNo } from '../lib/format';
import { LocalPicker, useWorkLocal } from '../components/shared';
import { NewItems } from './Waiter';

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

  const local = db.locales.find((l) => l.id === localId);
  const valid = !!(customer.name.trim() && customer.phone.trim() && (customer.address.trim() || customer.mapsUrl.trim()));

  if (sent) {
    return (
      <div className="page">
        <div className="card success-box">
          <span aria-hidden style={{ fontSize: '2.4rem' }}>✅</span>
          <b>Pedido {orderNo(db.orders.find((o) => o.id === sent.id) ?? { number: 0 })} enviado a cocina</b>
          <span className="muted">{sent.name} · {money(sent.total)} · {local?.name}</span>
          <button className="btn primary block" onClick={() => { setSent(null); setFormKey((k) => k + 1); }}>+ Tomar otro pedido</button>
        </div>
      </div>
    );
  }

  return (
    <NewItems
      key={formKey}
      title="Nuevo pedido delivery"
      localId={localId}
      canSend={valid}
      sendLabel={valid ? 'Enviar a cocina' : 'Faltan datos del cliente'}
      extra={
        <div className="card form-grid">
          <div className="full">
            <span className="muted small">Cocina que prepara el pedido</span>
            <LocalPicker value={localId} onChange={setLocalId} fixed={fixed} />
          </div>
          <label className="field"><span>Nombre *</span><input id="d-name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
          <label className="field"><span>Contacto (WhatsApp) *</span><input id="d-phone" type="tel" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="987654321" /></label>
          <label className="field full"><span>URL de ubicación (Google Maps)</span><input id="d-maps" type="url" value={customer.mapsUrl} onChange={(e) => setCustomer({ ...customer, mapsUrl: e.target.value })} placeholder="Pega el enlace que envió el cliente" /></label>
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
