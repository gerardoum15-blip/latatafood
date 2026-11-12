import { useState } from 'react';
import { mutate, useDb } from '../data/store';
import type { Order, TicketSettings } from '../types';
import { shrinkImage, ticketSettings } from '../lib/ticket';
import { TicketPreview } from '../components/TicketButton';
import defaultLogo from '../assets/logo-round.webp';

/** Ajustes > Ticket del cliente: logo y textos de arriba y abajo (el detalle del pedido no se edita). */
export function TicketSettingsCard() {
  const db = useDb();
  const t = ticketSettings(db);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<TicketSettings>) => mutate((d) => { d.settings.ticket = { ...ticketSettings(d), ...patch }; });

  // Ejemplo: el último pedido real, o uno de muestra.
  const sample: Order = [...db.orders].filter((o) => !o.cancelled).sort((a, b) => b.createdAt - a.createdAt)[0] ?? {
    id: 'muestra', number: 12061, localId: db.locales[0]?.id ?? '', channel: 'delivery', table: null,
    customer: { name: 'Cliente', phone: '', address: '', reference: '', mapsUrl: '' }, deliveryFee: 3, packagingQty: 2, packagingPrice: 1,
    plannedPay: 'efectivo', cashWith: null, driverId: null, note: '', kitchenStatus: 'listo', deliveryStatus: 'entregado', served: false,
    closed: true, cancelled: false, payments: [{ method: 'efectivo', amount: 30 }], createdAt: Date.now(), createdBy: '', createdByName: '',
    sentAt: Date.now(), readyAt: null, closedAt: Date.now(), history: [], sunat: { status: 'no_emitido', type: null },
    items: [{ id: 'm1', productId: 'muestra', name: 'Alitas Grande (10 uds)', basePrice: 25, unitPrice: 25, qty: 1, round: 1, note: '',
      modifiers: [{ groupId: 'g', groupName: 'Salsas', optionId: 'o', optionName: 'BBQ clásica', qty: 1, price: 0 }, { groupId: 'g2', groupName: 'Presentación', optionId: 'o2', optionName: 'Salsa aparte', qty: 1, price: 0 }] }],
  };

  return (
    <div className="card ticket-settings">
      <h3>Ticket del cliente</h3>
      <p className="muted small">La imagen que se envía al cliente por WhatsApp. Aquí cambias el logo y los textos; el detalle del pedido se llena solo.</p>
      <div className="row gap wrap">
        <img className="ticket-logo" src={t.logo || defaultLogo} alt="Logo del ticket" width={72} height={72} />
        <label className="btn small">
          Cambiar logo
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try { setErr(''); set({ logo: await shrinkImage(f) }); } catch { setErr('No se pudo leer esa imagen. Prueba con una foto PNG o JPG.'); }
          }} />
        </label>
        {t.logo && <button className="btn small ghost" onClick={() => set({ logo: '' })}>Usar logo de La Tata</button>}
      </div>
      {err && <p className="err-text small">{err}</p>}
      <label className="field"><span>Título (negrita)</span><input id="t-title" value={t.title} onChange={(e) => set({ title: e.target.value })} /></label>
      <label className="field"><span>Texto de arriba (RUC, teléfono, horario…)</span><textarea id="t-header" rows={4} value={t.header} onChange={(e) => set({ header: e.target.value })} /></label>
      <label className="field"><span>Texto de abajo (agradecimiento, hashtags…)</span><textarea id="t-footer" rows={4} value={t.footer} onChange={(e) => set({ footer: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={t.showIgv} onChange={(e) => set({ showIgv: e.target.checked })} /> Mostrar desglose de IGV (los precios ya lo incluyen)</label>
      {t.showIgv && (
        <label className="field inline"><span>IGV %</span><input id="t-igv" type="number" inputMode="decimal" value={t.igvRate} onChange={(e) => set({ igvRate: Math.max(0, Number(e.target.value)) })} /></label>
      )}
      <button className="btn" onClick={() => setPreview(true)}>Ver ejemplo del ticket</button>
      {preview && <TicketPreview order={sample} onClose={() => setPreview(false)} />}
    </div>
  );
}
