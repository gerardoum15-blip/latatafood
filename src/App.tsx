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
  if (hash === '#carta') return <CustomerApp />;
  if (!user) return <Login />;
  switch (user.role) {
    case 'admin': return <AdminScreen />;
    case 'mozo': return <RoleShell label="Mesas" main={<WaiterScreen />} />;
    case 'delivery': return <RoleShell label="Tomar pedido" main={<DeliveryScreen />} />;
    case 'cocina': return <RoleShell label="Cocina" main={<KitchenScreen />} local={user.localId ?? 'all'} />;
    case 'driver': return <RoleShell label="Mis entregas" main={<DriverScreen />} />;
  }
}

/** Pantalla de trabajo + Registro de pedidos (todos ven los estados). */
function RoleShell({ label, main, local = 'all' }: { label: string; main: ReactNode; local?: string }) {
  const [tab, setTab] = useState<'main' | 'log'>('main');
  return (
    <>
      <TopBar />
      <div className="role-tabs">
        <Tabs value={tab} onChange={setTab} options={[{ value: 'main', label }, { value: 'log', label: 'Registro de pedidos' }]} />
      </div>
      {tab === 'main' ? main : <OrderLog defaultLocal={local} />}
    </>
  );
}

function Login() {
  const db = useDb();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const users = db.users.filter((u) => u.active);

  const press = (d: string) => {
    setErr(false);
    const next = (pin + d).slice(0, 6);
    setPin(next);
    const match = users.find((u) => u.pin === next);
    if (match) { login(match.id); setPin(''); }
    else if (next.length === 6) { setErr(true); setPin(''); }
  };

  return (
    <div className="login">
      <div className="login-box">
        <h1>{db.settings.businessName}</h1>
        <p className="muted">Ingresa tu PIN</p>
        <div className={err ? 'pin-dots error' : 'pin-dots'} aria-live="polite">
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
        </div>
        {err && <p className="err-text">PIN incorrecto</p>}
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
          <button onClick={() => setPin('')} aria-label="Borrar todo">C</button>
          <button onClick={() => press('0')}>0</button>
          <button onClick={() => setPin(pin.slice(0, -1))} aria-label="Borrar">⌫</button>
        </div>
        <a className="btn block customer-entry" href="#carta">🍗 Soy cliente · Ver la carta y pedir</a>
        <details className="demo-users">
          <summary>Usuarios de prueba</summary>
          <ul>
            {users.map((u) => (
              <li key={u.id}><button className="link" onClick={() => login(u.id)}>{u.name}</button> <span className="muted">· {ROLE_LABEL[u.role]} · PIN {u.pin}</span></li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
