import { useEffect, useState, type ReactNode } from 'react';
import { login, useDb, useSession } from './data/store';
import { ROLE_LABEL } from './types';
import { Tabs, TopBar } from './components/ui';
import { OrderLog } from './screens/OrderLog';
import { AdminScreen } from './screens/Admin';
import { WaiterScreen } from './screens/Waiter';
import { DeliveryScreen } from './screens/Delivery';
import { KitchenScreen } from './screens/Kitchen';
import { DriverScreen } from './screens/Driver';
import { CustomerApp } from './screens/Customer';
import logo from './assets/logo.webp';
import { CLOUD, staffLogin, useCloud, useKitchenQueue } from './data/cloud';
import { hhmmLabel, hoursLabel, isOpenNow, localAddress, localMapsUrl, localOpen, waitMinutes } from './lib/rules';
import { OrderTracker, TrackingPage, useTracking } from './screens/OrderTracker';
import { DriversPanel } from './screens/DriversPanel';
import { DeviceSetup, Loading } from './screens/Device';

function useHash() {
  const [h, setH] = useState(() => (typeof location !== 'undefined' ? location.hash : ''));
  useEffect(() => {
    const on = () => setH(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

export default function App() {
  const user = useSession();
  const hash = useHash();
  const cloud = useCloud();
  if (hash === '#carta') return cloud.catalogReady ? <CustomerApp /> : <Loading text="Cargando la carta…" />;
  if (hash.startsWith('#seguir-')) return <TrackingPage id={decodeURIComponent(hash.slice('#seguir-'.length))} />;
  // Sin usuario: la portada es para clientes; el personal entra por "#personal" (o este celular ya es del personal).
  if (!user || (CLOUD && cloud.status !== 'ready')) {
    const staffView = hash === '#personal' || isStaffDevice();
    if (!staffView) return <Landing />;
    if (CLOUD && cloud.status === 'signed-out') return <DeviceSetup />;
    if (CLOUD && (cloud.status === 'checking' || cloud.status === 'loading' || cloud.status === 'error')) return <Loading />;
    return <Login />;
  }
  switch (user.role) {
    case 'admin': return <AdminScreen />;
    case 'mozo': return <RoleShell label="Mesas" main={<WaiterScreen />} drivers />;
    case 'delivery': return <RoleShell label="Tomar pedido" main={<DeliveryScreen />} drivers />;
    case 'cocina': return <RoleShell label="Cocina" main={<KitchenScreen />} local={user.localId ?? 'all'} />;
    case 'driver': return <RoleShell label="Mis entregas" main={<DriverScreen />} />;
  }
}

/** Pantalla de trabajo + Registro de pedidos (todos ven los estados). */
function RoleShell({ label, main, local = 'all', drivers }: { label: string; main: ReactNode; local?: string; drivers?: boolean }) {
  const [tab, setTab] = useState<'main' | 'log' | 'drivers'>('main');
  return (
    <>
      <TopBar />
      <div className="role-tabs">
        <Tabs value={tab} onChange={setTab} options={[{ value: 'main', label }, { value: 'log', label: 'Registro' }, ...(drivers ? [{ value: 'drivers' as const, label: 'Drivers' }] : [])]} />
      </div>
      {tab === 'main' ? main : tab === 'log' ? <OrderLog defaultLocal={local} /> : <DriversPanel />}
    </>
  );
}

function Login() {
  const db = useDb();
  const cloud = useCloud();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const users = db.users.filter((u) => u.active);
  const server = CLOUD && cloud.pinServer;

  // Con la nube, el PIN se valida en el servidor y se confirma con "Entrar".
  const submit = async (value: string) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    const r = await staffLogin(value);
    setBusy(false);
    setPin('');
    if (r.userId) { markStaffDevice(true); login(r.userId); } else setErr(r.error ?? 'PIN incorrecto');
  };

  const press = (d: string) => {
    setErr('');
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (server) { if (next.length === 6) void submit(next); return; }
    const match = users.find((u) => u.pin === next);
    if (match) { markStaffDevice(true); login(match.id); setPin(''); }
    else if (next.length === 6) { setErr('PIN incorrecto'); setPin(''); }
  };

  return (
    <div className="login">
      <div className="login-box">
        <h1 className="login-logo"><img src={logo} alt={db.settings.businessName} width={640} height={453} /></h1>
        <p className="staff-tag">Personal de La Tata Food</p>
        <p className="muted">Ingresa tu código de usuario</p>
        <div className={err ? 'pin-dots error' : 'pin-dots'} aria-live="polite">
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
        </div>
        {err && <p className="err-text" role="alert">{err}</p>}
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
          <button onClick={() => setPin('')} aria-label="Borrar todo">C</button>
          <button onClick={() => press('0')}>0</button>
          <button onClick={() => setPin(pin.slice(0, -1))} aria-label="Borrar">⌫</button>
        </div>
        {server && <button className="btn primary block" disabled={pin.length < 4 || busy} onClick={() => void submit(pin)}>{busy ? 'Verificando…' : 'Entrar'}</button>}
        <button className="link small" onClick={() => { markStaffDevice(false); location.hash = '#inicio'; }}>← Ir a la portada para clientes</button>
        {!CLOUD && <details className="demo-users">
          <summary>Usuarios de prueba</summary>
          <ul>
            {users.map((u) => (
              <li key={u.id}><button className="link" onClick={() => login(u.id)}>{u.name}</button> <span className="muted">· {ROLE_LABEL[u.role]} · PIN {u.pin}</span></li>
            ))}
          </ul>
        </details>}
      </div>
    </div>
  );
}

const STAFF_KEY = 'latatafood-staff-device';
/** Este celular es del personal: al abrir la app se muestra directo el teclado de código. */
function isStaffDevice() { try { return localStorage.getItem(STAFF_KEY) === '1'; } catch { return false; } }
function markStaffDevice(on: boolean) { try { if (on) localStorage.setItem(STAFF_KEY, '1'); else localStorage.removeItem(STAFF_KEY); } catch { /* sin almacenamiento */ } }

/** Portada pública: grande para clientes, acceso discreto para el personal. */
function Landing() {
  const db = useDb();
  const queue = useKitchenQueue();
  const tracking = useTracking();
  const [track, setTrack] = useState<string | null>(null);
  const wa = db.settings.whatsapp;
  const waText = wa.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  return (
    <div className="landing">
      <main className="landing-main">
        <img className="landing-logo" src={logo} alt={db.settings.businessName} width={640} height={453} />
        <h1>Salvándote la cena</h1>
        <p className="landing-sub"><b>Restaurante urbano de comida rápida</b><br />Broster + Salchipapa + Hamburguesas + Snacks + Refrescos</p>
        <a className="btn landing-cta" href="#carta">🍗 Ver la carta y pedir</a>
        {tracking[0] && <button className="btn block" onClick={() => setTrack(tracking[0].id)}>📦 Ver estado de mi pedido</button>}
        <ul className="landing-facts">
          <li><b>{waitMinutes(db, queue ?? 0)} min</b><span>tiempo de espera{queue !== null ? ` · ${queue} en cocina` : ''}</span></li>
          <li><b>WhatsApp</b><span><a href={`https://wa.me/51${wa}`} target="_blank" rel="noreferrer">{waText}</a></span></li>
        </ul>
        <ul className="landing-locals" aria-label="Nuestros locales">
          {db.locales.map((l) => {
            const open = isOpenNow(l);
            return (
              <li key={l.id}>
                <div className="local-row">
                  <b>{l.name}</b>
                  <span className={open ? 'open-pill on' : 'open-pill'}>{open ? 'Abierto ahora' : `Cerrado · abre ${hhmmLabel(localOpen(l))}`}</span>
                </div>
                <span>{localAddress(l)}</span>
                <span>🕕 {hoursLabel(l)} · todos los días</span>
                {localMapsUrl(l) && <a className="btn small local-map-btn" href={localMapsUrl(l)} target="_blank" rel="noreferrer">📍 Ver ubicación</a>}
              </li>
            );
          })}
        </ul>
      </main>
      <footer className="landing-staff">
        <a href="#personal">Personal de La Tata Food · Ingresar con código</a>
      </footer>
      {track && <OrderTracker id={track} onClose={() => setTrack(null)} />}
    </div>
  );
}
