import { useState } from 'react';
import { login, useDb, useSession } from './data/store';
import { ROLE_LABEL } from './types';
import { TopBar } from './components/ui';
import { AdminScreen } from './screens/Admin';
import { WaiterScreen } from './screens/Waiter';
import { DeliveryScreen } from './screens/Delivery';
import { KitchenScreen } from './screens/Kitchen';
import { DriverScreen } from './screens/Driver';

export default function App() {
  const user = useSession();
  if (!user) return <Login />;
  switch (user.role) {
    case 'admin': return <AdminScreen />;
    case 'mozo': return <><TopBar /><WaiterScreen /></>;
    case 'delivery': return <><TopBar /><DeliveryScreen /></>;
    case 'cocina': return <><TopBar /><KitchenScreen /></>;
    case 'driver': return <><TopBar /><DriverScreen /></>;
  }
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
