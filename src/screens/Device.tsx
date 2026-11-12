import { useState } from 'react';
import { retryLoad, signInDevice, useCloud } from '../data/cloud';
import logo from '../assets/logo.webp';

/** Primera vez en un celular del personal: pedir la clave del local. */
export function DeviceSetup() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form className="login-box" onSubmit={async (e) => {
        e.preventDefault();
        if (!pw) return;
        setBusy(true); setErr('');
        const r = await signInDevice(pw);
        setBusy(false);
        if (r) setErr(r);
      }}>
        <h1 className="login-logo"><img src={logo} alt="La Tata Food" width={640} height={453} /></h1>
        <h2>Conectar este celular</h2>
        <p className="muted">Escribe la clave del local. Solo se pide una vez en cada celular del personal.</p>
        <label className="field"><span>Clave del local</span>
          <input id="device-pass" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <p className="err-text">{err}</p>}
        <button className="btn primary block" type="submit" disabled={busy || !pw}>{busy ? 'Conectando…' : 'Conectar'}</button>
        <a className="btn block customer-entry" href="#carta">🍗 Soy cliente · Ver la carta y pedir</a>
      </form>
    </div>
  );
}

export function Loading({ text = 'Cargando…' }: { text?: string }) {
  const cloud = useCloud();
  return (
    <div className="login">
      <div className="login-box">
        <h1 className="login-logo"><img src={logo} alt="La Tata Food" width={640} height={453} /></h1>
        {cloud.status === 'error' ? (
          <>
            <p className="err-text">No se pudieron cargar los datos.</p>
            <p className="muted">{cloud.error}</p>
            <button className="btn primary block" onClick={retryLoad}>Reintentar</button>
          </>
        ) : <p className="muted">{text}</p>}
      </div>
    </div>
  );
}

/** Indicador pequeño en la barra superior: sin conexión o cambios por guardar. */
export function SyncBadge() {
  const c = useCloud();
  if (c.status !== 'ready') return null;
  if (!c.online) return <span className="sync-badge off" role="status">Sin conexión · {c.pending} por guardar</span>;
  if (c.pending) return <span className="sync-badge" role="status">Guardando…</span>;
  return null;
}
