import { useMemo, useState } from 'react';
import { generateDemoSales, mutate, orderTotal, resetAll, uid, useDb, useSession } from '../data/store';
import { PAY_LABEL, ROLE_LABEL, type Role, type User } from '../types';
import { dateTime, money } from '../lib/format';
import { periodRange, PERIOD_LABEL, type Period } from '../lib/reports';
import { LocalPicker } from '../components/shared';
import { ConfirmButton, Empty, Modal, TopBar } from '../components/ui';
import { WaiterScreen } from './Waiter';
import { DeliveryScreen } from './Delivery';
import { KitchenScreen } from './Kitchen';
import { ReportsScreen } from './Reports';
import { MenuAdmin } from './MenuAdmin';
import { OrderLog } from './OrderLog';

type Section = 'monitor' | 'salon' | 'delivery' | 'cocina' | 'reportes' | 'tickets' | 'carta' | 'usuarios' | 'ajustes';

const NAV: { key: Section; label: string; icon: string }[] = [
  { key: 'monitor', label: 'Pedidos', icon: '📋' },
  { key: 'salon', label: 'Salón', icon: '🍽' },
  { key: 'delivery', label: 'Delivery', icon: '🛵' },
  { key: 'cocina', label: 'Cocina', icon: '👨‍🍳' },
  { key: 'reportes', label: 'Reportes', icon: '📊' },
  { key: 'tickets', label: 'Tickets', icon: '🧾' },
  { key: 'carta', label: 'Carta', icon: '📖' },
  { key: 'usuarios', label: 'Usuarios', icon: '👥' },
  { key: 'ajustes', label: 'Ajustes', icon: '⚙️' },
];

export function AdminScreen() {
  const [sec, setSec] = useState<Section>('monitor');
  return (
    <div className="admin">
      <TopBar />
      <nav className="admin-nav" aria-label="Secciones">
        {NAV.map((n) => (
          <button key={n.key} className={sec === n.key ? 'nav-btn active' : 'nav-btn'} onClick={() => setSec(n.key)}>
            <span aria-hidden>{n.icon}</span>{n.label}
          </button>
        ))}
      </nav>
      <main>
        {sec === 'monitor' && <OrderLog admin />}
        {sec === 'salon' && <WaiterScreen />}
        {sec === 'delivery' && <DeliveryScreen />}
        {sec === 'cocina' && <KitchenScreen />}
        {sec === 'reportes' && <ReportsScreen />}
        {sec === 'tickets' && <Tickets />}
        {sec === 'carta' && <MenuAdmin />}
        {sec === 'usuarios' && <Users />}
        {sec === 'ajustes' && <SettingsScreen />}
      </main>
    </div>
  );
}

function Tickets() {
  const db = useDb();
  const [period, setPeriod] = useState<Period>('hoy');
  const [localId, setLocalId] = useState('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showInfo, setShowInfo] = useState(false);
  const [a, b] = periodRange(period);
  const list = useMemo(() => db.orders
    .filter((o) => o.closed && !o.cancelled && (o.closedAt ?? 0) >= a && (o.closedAt ?? 0) < b && (localId === 'all' || o.localId === localId))
    .sort((x, y) => (y.closedAt ?? 0) - (x.closedAt ?? 0)), [db.orders, a, b, localId]);
  const toggle = (id: string) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); setSel(s); };
  const selTotal = list.filter((o) => sel.has(o.id)).reduce((s, o) => s + orderTotal(o), 0);

  return (
    <div className="page wide">
      <div className="section-head"><h2>Tickets de venta</h2></div>
      <div className="filters">
        <div className="chips">
          {(['hoy', 'ayer', 'semana', 'mes'] as Period[]).map((p) => (
            <button key={p} className={period === p ? 'chip active' : 'chip'} onClick={() => { setPeriod(p); setSel(new Set()); }}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
        <LocalPicker value={localId} onChange={(v) => { setLocalId(v); setSel(new Set()); }} allowAll />
      </div>
      <div className="card row between wrap">
        <span>{sel.size} seleccionados · {money(selTotal)}</span>
        <div className="row gap">
          <button className="btn small" disabled={sel.size === 0} onClick={() => setShowInfo(true)}>Emitir boleta</button>
          <button className="btn small" disabled={sel.size === 0} onClick={() => setShowInfo(true)}>Emitir factura</button>
        </div>
      </div>
      {list.length === 0 ? <Empty>No hay tickets en este periodo.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th><input type="checkbox" aria-label="Seleccionar todos" checked={sel.size === list.length} onChange={(e) => setSel(e.target.checked ? new Set(list.map((o) => o.id)) : new Set())} /></th><th>Ticket</th><th className="hide-sm">Fecha</th><th>Detalle</th><th className="hide-sm">Pago</th><th className="num">Total</th><th className="hide-sm">SUNAT</th></tr></thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className={sel.has(o.id) ? 'selected' : ''} onClick={() => toggle(o.id)}>
                  <td><input type="checkbox" aria-label={`Seleccionar ticket ${o.number}`} checked={sel.has(o.id)} onChange={() => toggle(o.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td><b>#{o.number}</b><div className="muted small">{db.locales.find((l) => l.id === o.localId)?.name}</div><div className="muted small show-sm">{dateTime(o.closedAt!)}</div></td>
                  <td className="small hide-sm">{dateTime(o.closedAt!)}</td>
                  <td className="small">{o.channel === 'salon' ? `Mesa ${o.table}` : `Delivery · ${o.customer?.name}`}<div className="muted">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div></td>
                  <td className="small hide-sm">{o.payments.map((p) => PAY_LABEL[p.method]).join(' + ')}</td>
                  <td className="num">{money(orderTotal(o))}<div className="muted small show-sm">{o.payments.map((p) => PAY_LABEL[p.method]).join(' + ')}</div></td>
                  <td className="hide-sm"><span className="status s-enviado">No emitido</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showInfo && (
        <Modal title="Emisión SUNAT" onClose={() => setShowInfo(false)} footer={<button className="btn primary block" onClick={() => setShowInfo(false)}>Entendido</button>}>
          <p>La conexión con SUNAT se configurará en la etapa final, con un proveedor autorizado (OSE/PSE) y tu RUC.</p>
          <p className="muted">La selección ya funciona. Cuando esté conectada, los tickets seleccionados se enviarán como boleta o factura y aquí verás su estado.</p>
        </Modal>
      )}
    </div>
  );
}

const ROLES: Role[] = ['admin', 'cocina', 'mozo', 'delivery', 'driver'];

function Users() {
  const db = useDb();
  const me = useSession()!;
  const [edit, setEdit] = useState<User | null>(null);
  return (
    <div className="page">
      <div className="section-head"><h2>Usuarios</h2><button className="btn primary small" onClick={() => setEdit({ id: '', name: '', role: 'mozo', pin: '', localId: null, active: true })}>+ Nuevo usuario</button></div>
      {ROLES.map((r) => {
        const list = db.users.filter((u) => u.role === r);
        if (!list.length) return null;
        return (
          <div key={r} className="card">
            <h3>{ROLE_LABEL[r]}</h3>
            <ul className="list">
              {list.map((u) => (
                <li key={u.id} className={u.active ? '' : 'inactive'}>
                  <div className="grow"><b>{u.name}</b><div className="muted small">{db.locales.find((l) => l.id === u.localId)?.name ?? 'Todos los locales'}{!u.active && ' · desactivado'}</div></div>
                  <button className="btn small" onClick={() => setEdit(u)}>Editar</button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {edit && <UserForm initial={edit} isSelf={edit.id === me.id} onClose={() => setEdit(null)} />}
    </div>
  );
}

function UserForm({ initial, isSelf, onClose }: { initial: User; isSelf: boolean; onClose: () => void }) {
  const db = useDb();
  const [u, setU] = useState<User>(initial);
  const [err, setErr] = useState('');
  const save = () => {
    if (!u.name.trim()) return setErr('Escribe un nombre.');
    if (!/^\d{4,6}$/.test(u.pin)) return setErr('El PIN debe tener de 4 a 6 números.');
    if (db.users.some((x) => x.id !== u.id && x.pin === u.pin && x.active)) return setErr('Ese PIN ya lo usa otro usuario.');
    if (u.role === 'cocina' && !u.localId) return setErr('Cocina debe tener un local asignado.');
    mutate((d) => {
      const item = { ...u, name: u.name.trim(), id: u.id || uid('u') };
      const i = d.users.findIndex((x) => x.id === item.id);
      if (i >= 0) d.users[i] = item; else d.users.push(item);
    });
    onClose();
  };
  return (
    <Modal title={u.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose} footer={<button className="btn primary block" onClick={save}>Guardar</button>}>
      <label className="field"><span>Nombre</span><input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></label>
      <label className="field"><span>Función</span>
        <select value={u.role} disabled={isSelf} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      <label className="field"><span>Local {u.role === 'cocina' ? '(obligatorio)' : '(vacío = puede elegir local)'}</span>
        <select value={u.localId ?? ''} onChange={(e) => setU({ ...u, localId: e.target.value || null })}>
          <option value="">Todos / elige al trabajar</option>
          {db.locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <label className="field"><span>PIN de ingreso (4 a 6 números)</span><input inputMode="numeric" value={u.pin} onChange={(e) => setU({ ...u, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
      {!isSelf && <label className="check"><input type="checkbox" checked={u.active} onChange={(e) => setU({ ...u, active: e.target.checked })} /> Activo</label>}
      {err && <p className="err-text">{err}</p>}
    </Modal>
  );
}

function SettingsScreen() {
  const db = useDb();
  const s = db.settings;
  const [done, setDone] = useState('');
  const setS = (patch: Partial<typeof s>) => mutate((d) => { Object.assign(d.settings, patch); });
  return (
    <div className="page">
      <div className="section-head"><h2>Ajustes</h2></div>
      <div className="card">
        <label className="field"><span>Nombre del restaurante</span><input id="set-name" value={s.businessName} onChange={(e) => setS({ businessName: e.target.value })} /></label>
        <div className="field"><span>Enlace de la carta para clientes</span><a className="btn small" href="#carta">Abrir carta de clientes</a><span className="muted small">Comparte la dirección de la app terminada en <b>#carta</b>. Los clientes no necesitan PIN.</span></div>
        <label className="field"><span>Costo de empaque por plato (S/)</span><input id="set-pkg" type="number" inputMode="decimal" step="0.1" value={s.packagingPrice ?? 0.5} onChange={(e) => setS({ packagingPrice: Number(e.target.value) })} /></label>
        <label className="field"><span>WhatsApp de pedidos</span><input id="set-wa" type="tel" value={s.whatsapp} onChange={(e) => setS({ whatsapp: e.target.value })} /></label>
      </div>
      <div className="card">
        <h3>Locales</h3>
        {db.locales.map((l) => (
          <div key={l.id} className="pay-line">
            <input value={l.name} onChange={(e) => mutate((d) => { d.locales.find((x) => x.id === l.id)!.name = e.target.value; })} aria-label="Nombre del local" />
            <label className="field inline"><span>Mesas</span><input type="number" inputMode="numeric" value={l.tables} onChange={(e) => mutate((d) => { d.locales.find((x) => x.id === l.id)!.tables = Math.max(0, Number(e.target.value)); })} /></label>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Mensajes de WhatsApp al cliente</h3>
        <p className="muted small">Variables: {'{cliente} {numero} {negocio} {driver} {total} {pago} {local}'}</p>
        <label className="field"><span>Botón “Estoy en camino”</span><textarea id="msg-camino" rows={3} value={s.msgEnCamino} onChange={(e) => setS({ msgEnCamino: e.target.value })} /></label>
        <label className="field"><span>Botón “Ya llegué”</span><textarea id="msg-llegue" rows={3} value={s.msgLlegue} onChange={(e) => setS({ msgLlegue: e.target.value })} /></label>
      </div>
      <div className="card">
        <h3>Datos de prueba</h3>
        <p className="muted small">Por ahora los datos se guardan solo en este dispositivo. Cuando conectemos la base de datos en la nube se compartirán entre todos los usuarios.</p>
        <div className="row gap wrap">
          <button className="btn" onClick={() => { generateDemoSales(60); setDone('Se generaron ventas de ejemplo de los últimos 60 días. Revisa Reportes.'); }}>Generar ventas de ejemplo</button>
          <ConfirmButton label="Reiniciar todo" title="Reiniciar todo" message="Se borrarán todos los pedidos, usuarios y cambios de la carta, y volverá la carta de ejemplo." confirmLabel="Borrar todo" onConfirm={() => { resetAll(); setDone('Datos reiniciados.'); }} />
        </div>
        {done && <p className="notice">{done}</p>}
      </div>
    </div>
  );
}
