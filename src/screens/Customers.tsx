import { useMemo, useState } from 'react';
import { useDb } from '../data/store';
import { buildCustomers, TIER_LABEL } from '../lib/customers';
import { dateShort, money } from '../lib/format';
import { waLink } from '../lib/whatsapp';
import { loyalty } from '../lib/rules';
import { Empty } from '../components/ui';

/** Clientes: ficha por número de WhatsApp (pedidos, gasto, direcciones). */
export function CustomersScreen() {
  const db = useDb();
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<'all' | 'frecuente' | 'vip'>('all');
  const all = useMemo(() => [...buildCustomers(db).values()].sort((a, b) => b.orders - a.orders || b.spent - a.spent), [db]);
  const L = loyalty(db);
  const list = all.filter((c) => (tier === 'all' || c.tier === tier || (tier === 'frecuente' && c.tier === 'vip'))
    && (!q || c.phone.includes(q.replace(/\D/g, '')) || c.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="page wide">
      <div className="section-head"><h2>Clientes</h2><span className="muted small">{all.length} clientes · identificados por su WhatsApp</span></div>
      <input className="search" id="cust-search" placeholder="Buscar por número o nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={tier === 'all' ? 'chip active' : 'chip'} onClick={() => setTier('all')}>Todos</button>
        <button className={tier === 'frecuente' ? 'chip active' : 'chip'} onClick={() => setTier('frecuente')}>⭐ Frecuentes ({L.frequentMin}+ pedidos)</button>
        <button className={tier === 'vip' ? 'chip active' : 'chip'} onClick={() => setTier('vip')}>👑 VIP ({L.vipMin}+ pedidos)</button>
      </div>
      {list.length === 0 ? <Empty>Aún no hay clientes con pedidos delivery.</Empty> : (
        <div className="cards">
          {list.slice(0, 200).map((c) => (
            <article key={c.phone} className={`card customer-card tier-${c.tier}`}>
              <div className="row between wrap"><b>{c.name || 'Sin nombre'}</b><span className="small">{TIER_LABEL[c.tier]}</span></div>
              <div className="small">📱 {c.phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')} · <a href={waLink(c.phone)} target="_blank" rel="noreferrer">WhatsApp</a></div>
              <div className="small"><b>{c.orders}</b> {c.orders === 1 ? "pedido" : "pedidos"} · gastó <b>{money(c.spent)}</b> · promedio {money(c.orders ? c.spent / c.orders : 0)}</div>
              <div className="muted small">Cliente desde {dateShort(c.first)} · último pedido {dateShort(c.last)}</div>
              {c.addresses.length > 0 && (
                <ul className="list small">
                  {c.addresses.slice(0, 4).map((a) => (
                    <li key={a.address}><span className="grow">{a.label ? <b>{a.label}: </b> : null}{a.address}</span><span className="muted">{a.uses}×</span>{a.mapsUrl && <a href={a.mapsUrl} target="_blank" rel="noreferrer">mapa</a>}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
