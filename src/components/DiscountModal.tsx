import { useState } from 'react';
import type { Discount } from '../types';
import { money } from '../lib/format';
import { Modal } from './ui';

const REASONS = ['Promoción', 'Cliente frecuente', 'Cortesía', 'Compensación', 'Error en pedido'];

/** Descuento en S/ o %, con motivo. `base` es el monto sobre el que se aplica. */
export function DiscountModal({ title, base, initial, onApply, onRemove, onClose }: {
  title: string; base: number; initial?: Discount; onApply: (d: Discount) => void; onRemove?: () => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<'pct' | 'sol'>(initial && !initial.percent ? 'sol' : 'pct');
  const [value, setValue] = useState(initial ? String(initial.percent ?? initial.amount) : '');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const v = Number(value) || 0;
  const amount = Math.min(base, Math.round((mode === 'pct' ? (base * Math.min(v, 100)) / 100 : v) * 100) / 100);
  const valid = amount > 0 && reason.trim().length > 0;
  return (
    <Modal title={title} onClose={onClose} footer={
      <div className="row gap">
        {onRemove && initial && <button className="btn ghost danger" onClick={() => { onRemove(); onClose(); }}>Quitar</button>}
        <button className="btn primary grow" disabled={!valid} onClick={() => { onApply({ amount, percent: mode === 'pct' ? Math.min(v, 100) : undefined, reason: reason.trim() }); onClose(); }}>
          {valid ? `Aplicar −${money(amount)}` : amount > 0 ? 'Elige un motivo' : 'Escribe el descuento'}
        </button>
      </div>
    }>
      <p className="muted small">Sobre {money(base)}</p>
      <div className="local-picker" role="radiogroup" aria-label="Tipo de descuento">
        <button role="radio" aria-checked={mode === 'pct'} className={mode === 'pct' ? 'seg active' : 'seg'} onClick={() => setMode('pct')}>Porcentaje %</button>
        <button role="radio" aria-checked={mode === 'sol'} className={mode === 'sol' ? 'seg active' : 'seg'} onClick={() => setMode('sol')}>Monto S/</button>
      </div>
      {mode === 'pct' && (
        <div className="chips">
          {[5, 10, 15, 20, 50, 100].map((p) => <button key={p} className={v === p ? 'chip active' : 'chip'} onClick={() => setValue(String(p))}>{p}%</button>)}
        </div>
      )}
      <label className="field"><span>{mode === 'pct' ? 'Porcentaje' : 'Monto (S/)'}</span>
        <input id="disc-value" type="number" inputMode="decimal" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'pct' ? 'Ej. 10' : 'Ej. 2.50'} />
      </label>
      <label className="field"><span>Motivo (obligatorio)</span>
        <input id="disc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Promoción" />
      </label>
      <div className="chips">
        {REASONS.map((r) => <button key={r} className={reason === r ? 'chip active' : 'chip'} onClick={() => setReason(r)}>{r}</button>)}
      </div>
      {amount > 0 && <p className="discount-preview">Descuento: <b>−{money(amount)}</b> · queda {money(base - amount)}</p>}
    </Modal>
  );
}
