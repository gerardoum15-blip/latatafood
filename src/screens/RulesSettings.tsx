import { mutate, useDb } from '../data/store';
import { money } from '../lib/format';
import { packagingMax, packagingTiers, payInfo, waitTiers } from '../lib/rules';

/** Ajustes: empaques por precio, tiempo de espera y datos de pago. */
export function RulesSettings() {
  const db = useDb();
  const pt = packagingTiers(db);
  const wt = waitTiers(db);
  const pi = payInfo(db);
  const setPT = (next: typeof pt) => mutate((d) => { d.settings.packagingTiers = next; });
  const setWT = (next: typeof wt) => mutate((d) => { d.settings.waitTiers = next; });
  return (
    <>
      <div className="card ticket-settings">
        <h3>Empaque por plato</h3>
        <p className="muted small">Se cobra por cada plato según su precio, con un tope por plato. Bebidas y adicionales no llevan empaque. En mesa no se cobra.</p>
        <div className="tier-row muted small"><span>Plato desde (S/)</span><span>Empaque (S/)</span><span /></div>
        {pt.map((t, i) => (
          <div key={i} className="tier-row">
            <input type="number" inputMode="decimal" aria-label="Precio del plato desde" value={t.min} onChange={(e) => setPT(pt.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} />
            <input type="number" inputMode="decimal" step="0.5" aria-label="Costo de empaque" value={t.price} onChange={(e) => setPT(pt.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} />
            <button className="icon-btn" aria-label="Quitar fila" onClick={() => setPT(pt.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn ghost small" onClick={() => setPT([...pt, { min: 0, price: 0 }])}>+ Agregar rango</button>
        <label className="field inline"><span>Tope por plato (S/)</span><input id="pkg-max" type="number" inputMode="decimal" step="0.5" value={packagingMax(db)} onChange={(e) => mutate((d) => { d.settings.packagingMax = Number(e.target.value); })} /></label>
        <p className="muted small">Ejemplo: un plato de S/ 25 paga {money(Math.min([...pt].sort((a, b) => b.min - a.min).find((t) => 25 >= t.min)?.price ?? 0, packagingMax(db)))}.</p>
      </div>

      <div className="card ticket-settings">
        <h3>Tiempo de espera</h3>
        <p className="muted small">Lo ven los clientes en la carta, según los pedidos que hay en cocina (nuevos y en preparación).</p>
        <div className="tier-row muted small"><span>Desde N pedidos</span><span>Minutos</span><span /></div>
        {wt.map((t, i) => (
          <div key={i} className="tier-row">
            <input type="number" inputMode="numeric" aria-label="Pedidos en cocina desde" value={t.min} onChange={(e) => setWT(wt.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} />
            <input type="number" inputMode="numeric" aria-label="Minutos de espera" value={t.minutes} onChange={(e) => setWT(wt.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value) } : x)))} />
            <button className="icon-btn" aria-label="Quitar fila" onClick={() => setWT(wt.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn ghost small" onClick={() => setWT([...wt, { min: 0, minutes: 30 }])}>+ Agregar rango</button>
      </div>

      <div className="card ticket-settings">
        <h3>Datos de pago para clientes</h3>
        <label className="field"><span>Número de Yape</span><input id="pay-yape" inputMode="tel" value={pi.yape} onChange={(e) => mutate((d) => { d.settings.payInfo = { ...payInfo(d), yape: e.target.value }; })} /></label>
        <label className="field"><span>Número de Plin</span><input id="pay-plin" inputMode="tel" value={pi.plin} onChange={(e) => mutate((d) => { d.settings.payInfo = { ...payInfo(d), plin: e.target.value }; })} /></label>
        <label className="field"><span>Enlace de pago web (opcional)</span><input id="pay-web" type="url" value={pi.webUrl} placeholder="https://…" onChange={(e) => mutate((d) => { d.settings.payInfo = { ...payInfo(d), webUrl: e.target.value }; })} /><span className="muted small">Si lo dejas vacío, el cliente verá que le enviarán el enlace por WhatsApp.</span></label>
      </div>
    </>
  );
}
