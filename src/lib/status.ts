import type { Order } from '../types';

/** Estado general del pedido, el mismo para todos los usuarios. */
export type Stage = 'nuevo' | 'preparando' | 'listo' | 'reparto' | 'entregado' | 'anulado';

export const STAGES: Stage[] = ['nuevo', 'preparando', 'listo', 'reparto', 'entregado', 'anulado'];

export const STAGE_LABEL: Record<Stage, string> = {
  nuevo: 'Nuevo',
  preparando: 'Recibido · En preparación',
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
    case 'recibido': return 'preparando';
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

/** Mensaje de WhatsApp para contarle al cliente cómo va su pedido (delivery, recojo o InDrive). */
export function customerStatusText(o: Order, business: string, trackLink: string, driver?: string): string {
  const name = (o.customer?.name ?? '').split(' ')[0];
  const hi = `Hola${name ? ` ${name}` : ''}, te escribe ${business}.`;
  const no = o.number ? ` #${String(o.number).padStart(3, '0')}` : '';
  const pickup = o.selfDelivery === 'recojo';
  const indrive = o.selfDelivery === 'indrive';
  let body: string;
  switch (orderStage(o)) {
    case 'nuevo': body = `Recibimos tu pedido${no}. En breve empezamos a prepararlo.`; break;
    case 'preparando': body = `Tu pedido${no} ya se está preparando.`; break;
    case 'listo': body = pickup ? `¡Tu pedido${no} está listo! Ya puedes pasar a recogerlo.`
      : indrive ? `Tu pedido${no} está listo. Estamos pidiendo el InDrive para enviártelo.`
      : `Tu pedido${no} está listo y sale en unos minutos con el motorizado.`; break;
    case 'reparto': body = o.deliveryStatus === 'llego' ? `El motorizado ya llegó a tu dirección con tu pedido${no}. Por favor, sal a recibirlo.`
      : indrive ? `Tu pedido${no} ya va en camino por InDrive. Mantente atento a tu celular.`
      : `Tu pedido${no} ya va en camino${driver ? ` con ${driver}` : ''}. Mantente atento a tu celular.`; break;
    case 'entregado': body = `Tu pedido${no} fue entregado. ¡Gracias por tu compra, que lo disfrutes!`; break;
    case 'anulado': body = `Tu pedido${no} fue anulado. Escríbenos si tienes alguna duda.`; break;
  }
  const follow = ['entregado', 'anulado'].includes(orderStage(o)) ? '' : `\nSigue tu pedido aquí: ${trackLink}`;
  return `${hi}\n${body}${follow}`;
}
