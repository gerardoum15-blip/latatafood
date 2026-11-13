import { mutate, useDb } from '../data/store';
import { money } from '../lib/format';
import { deliveryTiers, kmLabel, loyalty, packagingMax, packagingTiers, payInfo, roadFactor, waitTiers } from '../lib/rules';

/** Ajustes: empaques por precio, tiempo de espera y datos de pago. */
export function RulesSettings() {
  const db = useDb();
  const pt = packagingTiers(db);
  const wt = waitTiers(db);
  const pi = payInfo(db);
  const setPT = (next: typeof pt) => mutate((d) => { d.settings.packagingTiers = next; });
  const setWT = (next: typeof wt) => mutate((d) => { d.settings.waitTiers = next; });
  const dt = deliveryTiers(db);
  const setDT = (next: typeof dt) => mutate((d) => { d.settings.deliveryTiers = next; });
  const ly = loyalty(db);
  const setLY = (patch: Partial<typeof ly>) => mutate((d) => { d.settings.loyalty = { ...loyalty(d), ...patch }; });
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
        <h3>Costo de delivery por distancia</h3>
        <p className="muted small">Se calcula con la ubicación del cliente y la del local (ubica tus locales arriba, en Locales). Más allá del último tramo se considera fuera de zona.</p>
        <div className="tier-row muted small"><span>Hasta (km)</span><span>Costo (S/)</span><span /></div>
        {dt.map((t, i) => (
          <div key={i} className="tier-row">
            <input type="number" inputMode="decimal" step="0.1" aria-label="Hasta kilómetros" value={t.upTo} onChange={(e) => setDT(dt.map((x, j) => (j === i ? { ...x, upTo: Number(e.target.value) } : x)))} />
            <input type="number" inputMode="decimal" step="0.5" aria-label="Costo de delivery" value={t.price} onChange={(e) => setDT(dt.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} />
            <button className="icon-btn" aria-label="Quitar tramo" onClick={() => setDT(dt.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn ghost small" onClick={() => setDT([...dt, { upTo: (dt[dt.length - 1]?.upTo ?? 0) + 1, price: 0 }])}>+ Agregar tramo</button>
        <label className="field inline"><span>Factor calles</span><input id="road-factor" type="number" inputMode="decimal" step="0.05" value={roadFactor(db)} onChange={(e) => mutate((d) => { d.settings.roadFactor = Number(e.target.value) || 1; })} /></label>
        <p className="muted small">La distancia se mide en línea recta y se multiplica por este factor para aproximar el recorrido por calles (1.3 = 30% más). Ej.: {kmLabel(1)} en línea recta ≈ {kmLabel(roadFactor(db))} por calles.</p>
      </div>

      <div className="card ticket-settings">
        <h3>Clientes frecuentes</h3>
        <p className="muted small">El cliente se reconoce por su número de WhatsApp. El mozo delivery ve su ficha al escribir el número.</p>
        <div className="tier-row muted small"><span>Desde N pedidos</span><span>Descuento sugerido %</span><span /></div>
        <div className="tier-row"><input type="number" inputMode="numeric" aria-label="Frecuente desde" value={ly.frequentMin} onChange={(e) => setLY({ frequentMin: Number(e.target.value) })} /><input type="number" inputMode="numeric" aria-label="Descuento frecuente" value={ly.frequentPct} onChange={(e) => setLY({ frequentPct: Number(e.target.value) })} /><span>⭐</span></div>
        <div className="tier-row"><input type="number" inputMode="numeric" aria-label="VIP desde" value={ly.vipMin} onChange={(e) => setLY({ vipMin: Number(e.target.value) })} /><input type="number" inputMode="numeric" aria-label="Descuento VIP" value={ly.vipPct} onChange={(e) => setLY({ vipPct: Number(e.target.value) })} /><span>👑</span></div>
        <p className="muted small">Con 0% no se sugiere descuento; solo se muestra la etiqueta.</p>
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
