import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMenuUpdates } from '../data/menuUpdates';
import { generateDemoSales, getDb, mutate, orderTotal, resetAll, uid, useDb, useSession } from '../data/store';
import { PAY_LABEL, ROLE_LABEL, type Role, type User } from '../types';
import { dateTime, money, orderNo } from '../lib/format';
import { periodRange, PERIOD_LABEL, type Period } from '../lib/reports';
import { LocalPicker } from '../components/shared';
import { ConfirmButton, Empty, Modal, TopBar, useTick } from '../components/ui';
import { WaiterScreen } from './Waiter';
import { DeliveryScreen } from './Delivery';
import { KitchenScreen } from './Kitchen';
import { ReportsScreen } from './Reports';
import { MenuAdmin } from './MenuAdmin';
import { OrderLog } from './OrderLog';
import { driverList } from '../lib/drivers';
import { DriversPanel } from './DriversPanel';
import { CustomersScreen } from './Customers';
import { TicketButton } from '../components/TicketButton';
import { TicketSettingsCard } from './TicketSettings';
import { RulesSettings } from './RulesSettings';
import { localAddress, localClose, localMapsUrl, localOpen } from '../lib/rules';
import { beep } from './Kitchen';
import { CLOUD, useRequests, downloadBackup, fetchSecuritySummary, logoutAllDevices, setStaffPin, signOutDevice, useCloud, type SecuritySummary } from '../data/cloud';

type Section = 'monitor' | 'drivers' | 'clientes' | 'salon' | 'delivery' | 'cocina' | 'reportes' | 'tickets' | 'carta' | 'usuarios' | 'ajustes';

const NAV: { key: Section; label: string; icon: string }[] = [
  { key: 'monitor', label: 'Pedidos', icon: '📋' },
  { key: 'drivers', label: 'Drivers', icon: '📍' },
  { key: 'clientes', label: 'Clientes', icon: '⭐' },
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
  const cloud = useCloud();
  // Al entrar el administrador, se agregan a la carta los platos nuevos (ej. combos de lunes a viernes).
  useEffect(() => {
    if (cloud.status !== 'ready' && CLOUD) return;
    const probe = structuredClone(getDb());
    if (applyMenuUpdates(probe)) mutate((d) => { applyMenuUpdates(d); });
  }, [cloud.status]);
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
      <AdminAlerts go={setSec} />
      <main>
        {sec === 'monitor' && <OrderLog admin />}
        {sec === 'drivers' && <DriversPanel showMoney />}
        {sec === 'clientes' && <CustomersScreen />}
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
                  <td><b>{orderNo(o)}</b><div className="muted small">{db.locales.find((l) => l.id === o.localId)?.name}</div><div className="muted small show-sm">{dateTime(o.closedAt!)}</div></td>
                  <td className="small hide-sm">{dateTime(o.closedAt!)}</td>
                  <td className="small">{o.channel === 'salon' ? `Mesa ${o.table}` : `Delivery · ${o.customer?.name}`}<div className="muted">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div></td>
                  <td className="small hide-sm">{o.payments.map((p) => PAY_LABEL[p.method]).join(' + ')}</td>
                  <td className="num">{money(orderTotal(o))}<div><TicketButton order={o} className="btn small ghost" label="🧾" /></div><div className="muted small show-sm">{o.payments.map((p) => PAY_LABEL[p.method]).join(' + ')}</div></td>
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
      <DriversEditor />
      {CLOUD && <SecurityCard />}
      {edit && <UserForm initial={edit} isSelf={edit.id === me.id} onClose={() => setEdit(null)} />}
    </div>
  );
}

function UserForm({ initial, isSelf, onClose }: { initial: User; isSelf: boolean; onClose: () => void }) {
  const db = useDb();
  const cloud = useCloud();
  const server = CLOUD && cloud.pinServer;
  const [u, setU] = useState<User>(server ? { ...initial, pin: '' } : initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = !u.id;
  const save = async () => {
    if (!u.name.trim()) return setErr('Escribe un nombre.');
    if ((u.role === 'cocina' || u.role === 'mozo') && !u.localId) return setErr(`${u.role === 'cocina' ? 'Cocina' : 'El mozo de mesa'} debe tener un local asignado: solo verá los pedidos de ese local.`);
    if (server) {
      // PIN cifrado en el servidor: vacío = no cambiar (obligatorio solo para usuarios nuevos).
      if (u.pin && !/^\d{4,6}$/.test(u.pin)) return setErr('El código debe tener de 4 a 6 números.');
      if (u.pin && u.role === 'admin' && u.pin.length < 6) return setErr('El código del Administrador debe tener 6 números.');
      if (isNew && !u.pin) return setErr('Escribe un PIN para el nuevo usuario.');
    } else {
      if (!/^\d{4,6}$/.test(u.pin)) return setErr('El PIN debe tener de 4 a 6 números.');
      if (db.users.some((x) => x.id !== u.id && x.pin === u.pin && x.active)) return setErr('Ese PIN ya lo usa otro usuario.');
    }
    const id = u.id || uid('u');
    if (server) {
      setBusy(true);
      const e = await setStaffPin(id, u.pin, u.role, u.active);
      setBusy(false);
      if (e) return setErr(e);
    }
    mutate((d) => {
      const item = { ...u, name: u.name.trim(), id, pin: server ? '' : u.pin };
      const i = d.users.findIndex((x) => x.id === item.id);
      if (i >= 0) d.users[i] = item; else d.users.push(item);
    });
    onClose();
  };
  return (
    <Modal title={u.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose} footer={<button className="btn primary block" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar'}</button>}>
      <label className="field"><span>Nombre</span><input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></label>
      <label className="field"><span>Función</span>
        <select value={u.role} disabled={isSelf} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      <label className="field"><span>Local {u.role === 'cocina' || u.role === 'mozo' ? '(obligatorio: solo verá este local)' : '(vacío = puede elegir local)'}</span>
        <select value={u.localId ?? ''} onChange={(e) => setU({ ...u, localId: e.target.value || null })}>
          <option value="">Todos / elige al trabajar</option>
          {db.locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <label className="field"><span>{server && !isNew ? 'Nuevo PIN (déjalo vacío para no cambiarlo)' : 'PIN de ingreso (4 a 6 números)'}</span><input id="u-pin" inputMode="numeric" autoComplete="off" value={u.pin} onChange={(e) => setU({ ...u, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
      {server && <p className="muted small">Los PIN se guardan cifrados: nadie puede verlos, solo cambiarlos.</p>}
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
        <label className="field"><span>WhatsApp de pedidos</span><input id="set-wa" type="tel" value={s.whatsapp} onChange={(e) => setS({ whatsapp: e.target.value })} /></label>
      </div>
      <div className="card">
        <h3>Locales</h3>
        {db.locales.map((l) => (
          <div key={l.id} className="local-edit">
            <div className="pay-line">
              <input value={l.name} onChange={(e) => mutate((d) => { d.locales.find((x) => x.id === l.id)!.name = e.target.value; })} aria-label="Nombre del local" />
              <label className="field inline"><span>Mesas</span><input type="number" inputMode="numeric" value={l.tables} onChange={(e) => mutate((d) => { d.locales.find((x) => x.id === l.id)!.tables = Math.max(0, Number(e.target.value)); })} /></label>
            </div>
            <input value={localAddress(l)} placeholder="Dirección (la ven los clientes)" aria-label={`Dirección de ${l.name}`} onChange={(e) => mutate((d) => { d.locales.find((x) => x.id === l.id)!.address = e.target.value; })} />
            <input type="url" value={localMapsUrl(l)} placeholder="Enlace de Google Maps del local" aria-label={`Ubicación de ${l.name}`} onChange={(e) => mutate((d) => { d.locales.find((x) => x.id === l.id)!.mapsUrl = e.target.value; })} />
            <div className="pay-line">
              <label className="field inline"><span>Abre</span><input type="time" value={localOpen(l)} onChange={(e) => mutate((d) => { d.locales.find((x) => x.id === l.id)!.open = e.target.value; })} /></label>
              <label className="field inline"><span>Cierra</span><input type="time" value={localClose(l)} onChange={(e) => mutate((d) => { d.locales.find((x) => x.id === l.id)!.close = e.target.value; })} /></label>
            </div>
          </div>
        ))}
      </div>
      <RulesSettings />
      <TicketSettingsCard />
      <div className="card">
        <h3>Mensajes de WhatsApp al cliente</h3>
        <p className="muted small">Variables: {'{cliente} {numero} {negocio} {driver} {total} {pago} {local}'}</p>
        <label className="field"><span>Botón “Estoy en camino”</span><textarea id="msg-camino" rows={3} value={s.msgEnCamino} onChange={(e) => setS({ msgEnCamino: e.target.value })} /></label>
        <label className="field"><span>Botón “Ya llegué”</span><textarea id="msg-llegue" rows={3} value={s.msgLlegue} onChange={(e) => setS({ msgLlegue: e.target.value })} /></label>
      </div>
      {CLOUD ? (
        <div className="card">
          <h3>Este celular</h3>
          <p className="muted small">Conectado a la base de datos de La Tata Food. Los pedidos se comparten en tiempo real con todos los celulares del personal.</p>
          <button className="btn" onClick={() => { setDone('Preparando respaldo…'); void downloadBackup(db).then((n) => { markBackup(); setDone(`Respaldo descargado: ${n} pedidos, carta y usuarios (sin códigos). Guárdalo en tu Google Drive o correo.`); }); }}>⬇ Descargar respaldo completo</button>
          {done && <p className="notice">{done}</p>}
          <ConfirmButton label="Desconectar este celular" title="Desconectar este celular" message="Para volver a usar la app en este celular habrá que escribir la clave del local." confirmLabel="Desconectar" onConfirm={() => { void signOutDevice(); }} />
        </div>
      ) : (
        <div className="card">
          <h3>Datos de prueba</h3>
          <p className="muted small">Por ahora los datos se guardan solo en este dispositivo.</p>
          <div className="row gap wrap">
            <button className="btn" onClick={() => { generateDemoSales(60); setDone('Se generaron ventas de ejemplo de los últimos 60 días. Revisa Reportes.'); }}>Generar ventas de ejemplo</button>
            <ConfirmButton label="Reiniciar todo" title="Reiniciar todo" message="Se borrarán todos los pedidos, usuarios y cambios de la carta, y volverá la carta de ejemplo." confirmLabel="Borrar todo" onConfirm={() => { resetAll(); setDone('Datos reiniciados.'); }} />
          </div>
          {done && <p className="notice">{done}</p>}
        </div>
      )}
    </div>
  );
}

/** Seguridad: intentos fallidos, celulares conectados y cierre de sesiones. */
function SecurityCard() {
  const [sum, setSum] = useState<SecuritySummary | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { void fetchSecuritySummary().then(setSum); }, []);
  return (
    <div className="card ticket-settings">
      <h3>🔒 Seguridad</h3>
      {sum ? (
        <div className="kpis">
          <div className="kpi"><span>Códigos errados (24 h)</span><b>{sum.failed_24h}</b><small>{sum.failed_1h} en la última hora</small></div>
          <div className="kpi"><span>Celulares con sesión</span><b>{sum.devices}</b><small>del personal</small></div>
          <div className="kpi"><span>Base de datos</span><b>{sum.db_size_mb} MB</b><small>de 500 MB del plan gratis</small></div>
        </div>
      ) : <p className="muted small">Ejecuta el archivo 07-seguridad.sql en Supabase para ver este resumen.</p>}
      {sum && sum.failed_1h >= 10 && <p className="err-text small">Muchos códigos errados en la última hora: alguien podría estar probando códigos. Cambia los códigos y cierra las sesiones.</p>}
      <p className="muted small">Si se pierde o roban un celular del personal, cierra todas las sesiones: cada uno tendrá que volver a escribir su código.</p>
      <ConfirmButton className="btn ghost danger" label="Cerrar sesión en todos los demás celulares" title="Cerrar todas las sesiones" message="Todos los celulares del personal (menos este) tendrán que volver a ingresar su código." confirmLabel="Cerrar sesiones"
        onConfirm={() => { void logoutAllDevices().then((r) => setMsg(r.error ? r.error : `Listo: se cerró la sesión en ${r.n} ${r.n === 1 ? 'celular' : 'celulares'}.`)); }} />
      {msg && <p className="notice">{msg}</p>}
    </div>
  );
}

/** Drivers: personas que reparten. Entran todas con un mismo usuario de función "Driver" y eligen quién maneja. */
function DriversEditor() {
  const db = useDb();
  const list = driverList(db);
  const save = (next: typeof list) => mutate((d) => { d.settings.drivers = next; });
  const loginUsers = db.users.filter((u) => u.role === 'driver' && u.active);
  return (
    <div className="card ticket-settings">
      <h3>🛵 Drivers (quién reparte)</h3>
      <p className="muted small">Todos los drivers entran con el mismo código (usuario con función "Driver") y al entrar eligen su nombre. Los pedidos se reparten por turno entre los <b>activos</b>: desactiva a quien no trabaja hoy.</p>
      {list.map((dr, i) => (
        <div key={dr.id} className="pay-line">
          <input aria-label="Nombre del driver" value={dr.name} onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <label className="check"><input type="checkbox" checked={dr.active} onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} /> Activo</label>
        </div>
      ))}
      <button className="btn ghost small" onClick={() => save([...list, { id: uid('drv'), name: 'Nuevo driver', active: true }])}>+ Agregar driver</button>
      <p className="muted small">Usuario de ingreso de drivers: {loginUsers.length ? loginUsers.map((u) => u.name).join(', ') : 'ninguno: crea un usuario con función "Driver"'}. Si quieres un solo código para todos, deja activo solo uno de esos usuarios.</p>
    </div>
  );
}

const BACKUP_KEY = 'latatafood-ultimo-respaldo';
const lastBackup = () => { try { return Number(localStorage.getItem(BACKUP_KEY)) || 0; } catch { return 0; } };
const markBackup = () => { try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* sin espacio */ } };

/** Avisos para el administrador: pedidos web sin confirmar y respaldo semanal. */
function AdminAlerts({ go }: { go: (s: Section) => void }) {
  const db = useDb();
  useTick(30000);
  const requests = useRequests();
  const late = requests.filter((r) => r.status === 'pendiente' && Date.now() - new Date(r.created_at).getTime() > 5 * 60000);
  const [backupAt, setBackupAt] = useState(lastBackup);
  const [busy, setBusy] = useState(false);
  const prevLate = useRef(0);
  useEffect(() => {
    if (late.length > prevLate.current) beep();
    prevLate.current = late.length;
  }, [late.length]);
  const backupDue = CLOUD && Date.now() - backupAt > 7 * 86400000;
  if (!late.length && !backupDue) return null;
  return (
    <div className="admin-alerts">
      {late.length > 0 && (
        <div className="alert-bar warn" role="alert">
          <span>⏰ <b>{late.length} pedido{late.length > 1 ? 's' : ''} web</b> esperando confirmación hace más de 5 min. Solo el mozo delivery puede confirmarlo: avísale.</span>
          <button className="btn small" onClick={() => go('delivery')}>Ver</button>
        </div>
      )}
      {backupDue && (
        <div className="alert-bar" role="status">
          <span>💾 {backupAt ? 'Hace más de 7 días que no descargas' : 'Aún no descargas'} un respaldo de pedidos, carta y usuarios.</span>
          <button className="btn small" disabled={busy} onClick={() => { setBusy(true); void downloadBackup(db).then(() => { markBackup(); setBackupAt(Date.now()); setBusy(false); }); }}>{busy ? 'Preparando…' : 'Descargar ahora'}</button>
        </div>
      )}
    </div>
  );
}
