import { useEffect, useState, type ReactNode } from 'react';
import { lineTotal, logout, useDb, useSession } from '../data/store';
import { ROLE_LABEL, type Order, type OrderItem } from '../types';
import { SyncBadge } from '../screens/Device';
import { money } from '../lib/format';

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function TopBar({ title, right }: { title?: string; right?: ReactNode }) {
  const user = useSession();
  const db = useDb();
  const local = db.locales.find((l) => l.id === user?.localId);
  return (
    <header className="topbar">
      <div className="topbar-main">
        <div className="brand">{db.settings.businessName}</div>
        <div className="who">{user?.name} · {user ? ROLE_LABEL[user.role] : ''}{local ? ` · ${local.name}` : ''}</div>
      </div>
      {title && <div className="topbar-title">{title}</div>}
      <div className="topbar-right">
        <SyncBadge />
        {right}
        <button className="btn ghost small" onClick={logout}>Salir</button>
      </div>
    </header>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'tab active' : 'tab'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ItemLines({ items, big, showPrices = true, highlightRound }: { items: OrderItem[]; big?: boolean; showPrices?: boolean; highlightRound?: number }) {
  return (
    <ul className={big ? 'item-lines big' : 'item-lines'}>
      {items.map((it) => (
        <li key={it.id} className={highlightRound && it.round === highlightRound && highlightRound > 1 ? 'new-round' : ''}>
          <div className="item-row">
            <span className="item-qty">{it.qty}×</span>
            <span className="item-name">{it.name}</span>
            {showPrices && <span className="item-price">{it.discount ? <><s className="muted">{money(it.unitPrice * it.qty)}</s> {money(lineTotal(it))}</> : money(it.unitPrice * it.qty)}</span>}
          </div>
          {it.modifiers.length > 0 && (
            <div className="item-mods">
              {groupMods(it).map(([g, opts]) => (
                <div key={g}><b>{g}:</b> {opts}</div>
              ))}
            </div>
          )}
          {it.note && <div className="item-note">📝 {it.note}</div>}
          {showPrices && it.discount && <div className="item-discount">Descuento −{money(it.discount.amount)}{it.discount.percent ? ` (${it.discount.percent}%)` : ''} · {it.discount.reason}</div>}
        </li>
      ))}
    </ul>
  );
}

function groupMods(it: OrderItem): [string, string][] {
  const m = new Map<string, string[]>();
  for (const mod of it.modifiers) {
    const arr = m.get(mod.groupName) ?? [];
    arr.push(mod.qty > 1 ? `${mod.qty}× ${mod.optionName}` : mod.optionName);
    m.set(mod.groupName, arr);
  }
  return [...m.entries()].map(([g, a]) => [g, a.join(', ')]);
}

export function Timeline({ order }: { order: Order }) {
  return (
    <ol className="timeline">
      {order.history.map((h, i) => (
        <li key={i}>
          <span className="tl-time">{new Date(h.at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</span>
          <span>{h.label}</span>
          <span className="muted"> · {h.userName}</span>
        </li>
      ))}
    </ol>
  );
}

/** Fuerza un re-render periódico (para relojes de "hace X min"). */
export function useTick(ms = 30000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Botón con confirmación dentro de la app (los diálogos del navegador no funcionan en todos los teléfonos). */
export function ConfirmButton({ className = 'btn ghost danger', label, title, message, confirmLabel = 'Confirmar', reason, onConfirm }: {
  className?: string; label: ReactNode; title: string; message?: ReactNode; confirmLabel?: string; reason?: boolean; onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <>
      <button className={className} onClick={() => { setText(''); setOpen(true); }}>{label}</button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)} footer={
          <div className="row gap">
            <button className="btn ghost grow" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn danger-solid grow" onClick={() => { setOpen(false); onConfirm(text.trim()); }}>{confirmLabel}</button>
          </div>
        }>
          {message && <p>{message}</p>}
          {reason && (
            <label className="field"><span>Motivo</span><input id="confirm-reason" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej. cliente canceló" autoFocus /></label>
          )}
        </Modal>
      )}
    </>
  );
}
