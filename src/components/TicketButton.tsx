import { useEffect, useState } from 'react';
import { useDb } from '../data/store';
import type { Order } from '../types';
import { renderTicket } from '../lib/ticket';
import { Modal } from './ui';

/** Botón que genera el ticket como imagen PNG y permite compartirlo (WhatsApp) o descargarlo. */
export function TicketButton({ order, className = 'btn small', label = '🧾 Ticket' }: { order: Order; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{label}</button>
      {open && <TicketPreview order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

export function TicketPreview({ order, onClose }: { order: Order; onClose: () => void }) {
  const db = useDb();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    let made = '';
    renderTicket(order, db)
      .then((blob) => {
        if (!alive) return;
        const f = new File([blob], `ticket-${order.number || 'pedido'}.png`, { type: 'image/png' });
        made = URL.createObjectURL(f);
        setFile(f);
        setUrl(made);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    // Se genera una vez al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  return (
    <Modal title={`Ticket ${order.number ? `#${order.number}` : ''}`} onClose={onClose} footer={
      <div className="row gap">
        {url && <a className="btn grow" href={url} download={file?.name}>Descargar</a>}
        {canShare && (
          <button className="btn wa grow" onClick={() => { void navigator.share({ files: [file!], title: `Ticket ${order.number}` }).catch(() => undefined); }}>
            Compartir (WhatsApp)
          </button>
        )}
      </div>
    }>
      {err && <p className="err-text">{err}</p>}
      {!url && !err && <p className="muted">Generando ticket…</p>}
      {url && <img className="ticket-img" src={url} alt={`Ticket del pedido ${order.number}`} />}
      {url && !canShare && <p className="muted small">En este dispositivo no se puede compartir directo: descarga la imagen y envíala por WhatsApp.</p>}
    </Modal>
  );
}
