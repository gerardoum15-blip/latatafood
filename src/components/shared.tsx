import { useState } from 'react';
import { useDb } from '../data/store';
import { PAY_LABEL, type PayMethod, type Payment } from '../types';
import { money } from '../lib/format';
import { Modal } from './ui';

const LOCAL_KEY = 'pos-restaurante-local';

/** Local de trabajo elegido por el usuario (mozo / delivery / driver). */
export function useWorkLocal(fixed: string | null): [string, (id: string) => void] {
  const db = useDb();
  const [val, setVal] = useState<string>(() => {
    if (fixed) return fixed;
    try { return localStorage.getItem(LOCAL_KEY) ?? db.locales[0]?.id ?? ''; } catch { return db.locales[0]?.id ?? ''; }
  });
  const set = (id: string) => {
    setVal(id);
    try { localStorage.setItem(LOCAL_KEY, id); } catch { /* sin almacenamiento */ }
  };
  const valid = db.locales.some((l) => l.id === val) ? val : db.locales[0]?.id ?? '';
  return [fixed ?? valid, set];
}

export function LocalPicker({ value, onChange, fixed, allowAll }: { value: string; onChange: (id: string) => void; fixed?: boolean; allowAll?: boolean }) {
  const db = useDb();
  if (fixed) {
    return <div className="local-picker"><span className="local-badge">{db.locales.find((l) => l.id === value)?.name}</span></div>;
  }
  return (
    <div className="local-picker" role="radiogroup" aria-label="Local">
      {allowAll && (
        <button role="radio" aria-checked={value === 'all'} className={value === 'all' ? 'seg active' : 'seg'} onClick={() => onChange('all')}>Todos</button>
      )}
      {db.locales.map((l) => (
        <button key={l.id} role="radio" aria-checked={value === l.id} className={value === l.id ? 'seg active' : 'seg'} onClick={() => onChange(l.id)}>
          {l.name}
        </button>
      ))}
    </div>
  );
}

const METHODS: PayMethod[] = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia'];

export function PaymentModal({ total, onClose, onConfirm }: { total: number; onClose: () => void; onConfirm: (p: Payment[]) => void }) {
  const [lines, setLines] = useState<Payment[]>([{ method: 'efectivo', amount: Math.round(total * 100) / 100 }]);
  const [cashGiven, setCashGiven] = useState('');
  const paid = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const diff = Math.round((total - paid) * 100) / 100;
  const cash = lines.filter((l) => l.method === 'efectivo').reduce((s, l) => s + l.amount, 0);
  const change = cashGiven ? Number(cashGiven) - cash : 0;

  return (
    <Modal
      title={`Cobrar ${money(total)}`}
      onClose={onClose}
      footer={<button className="btn primary block" disabled={diff !== 0} onClick={() => onConfirm(lines.filter((l) => l.amount > 0))}>
        {diff === 0 ? 'Confirmar cobro' : diff > 0 ? `Faltan ${money(diff)}` : `Sobran ${money(-diff)}`}
      </button>}
    >
      {lines.map((l, idx) => (
        <div key={idx} className="pay-line">
          <select value={l.method} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, method: e.target.value as PayMethod } : x)))}>
            {METHODS.map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
          </select>
          <input type="number" inputMode="decimal" step="0.1" value={l.amount || ''} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, amount: Number(e.target.value) } : x)))} />
          {lines.length > 1 && <button className="icon-btn" aria-label="Quitar" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>✕</button>}
        </div>
      ))}
      <button className="btn ghost small" onClick={() => setLines([...lines, { method: 'yape', amount: Math.max(0, diff) }])}>+ Pago mixto (dividir)</button>
      {cash > 0 && (
        <label className="field">
          <span>El cliente paga con (efectivo)</span>
          <input type="number" inputMode="decimal" value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} placeholder={String(cash)} />
          {cashGiven && <strong className={change < 0 ? 'err-text' : 'ok-text'}>{change < 0 ? `Falta ${money(-change)}` : `Vuelto: ${money(change)}`}</strong>}
        </label>
      )}
    </Modal>
  );
}
