import type { Order } from '../types';

/** Estado general del pedido, el mismo para todos los usuarios. */
export type Stage = 'nuevo' | 'recibido' | 'preparando' | 'listo' | 'reparto' | 'entregado' | 'anulado';

export const STAGES: Stage[] = ['nuevo', 'recibido', 'preparando', 'listo', 'reparto', 'entregado', 'anulado'];

export const STAGE_LABEL: Record<Stage, string> = {
  nuevo: 'Nuevo',
  recibido: 'Recibido',
  preparando: 'En preparación',
  listo: 'Listo',
  reparto: 'En reparto',
  entregado: 'Entregado',
  anulado: 'Anulado',
};

export function orderStage(o: Order): Stage {
  if (o.cancelled) return 'anulado';
  if (o.channel === 'delivery') {
    if (o.deliveryStatus === 'entregado') return 'entregado';
    if (o.deliveryStatus === 'en_camino' || o.deliveryStatus === 'llego') return 'reparto';
  } else if (o.closed || o.served) {
    return 'entregado';
  }
  switch (o.kitchenStatus) {
    case 'enviado': return 'nuevo';
    case 'recibido': return 'recibido';
    case 'preparando': return 'preparando';
    case 'listo': return 'listo';
  }
}

/** Texto extra del estado según el canal (ej. "esperando driver"). */
export function stageHint(o: Order): string {
  const st = orderStage(o);
  if (st === 'listo') return o.channel === 'delivery' ? 'esperando driver' : 'para servir';
  if (st === 'reparto' && o.deliveryStatus === 'llego') return 'driver en la ubicación';
  if (st === 'entregado' && o.channel === 'salon') return o.closed ? 'cobrado' : 'en mesa';
  return '';
}
