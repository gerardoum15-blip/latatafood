export const money = (n: number) =>
  'S/ ' + (Math.round(n * 100) / 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const time = (t: number) =>
  new Date(t).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

export const dateTime = (t: number) =>
  new Date(t).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const minutesAgo = (t: number) => Math.max(0, Math.floor((Date.now() - t) / 60000));

export const fmtMinutes = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);

const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DAY_NAMES = DAY_SHORT;

/** ¿Está disponible hoy? (sin días marcados = todos los días) */
export const availableToday = (p: { days?: number[] }) => !p.days?.length || p.days.includes(new Date().getDay());

export function daysLabel(days?: number[]): string {
  if (!days?.length || days.length === 7) return 'Todos los días';
  const s = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (s.join() === '1,2,3,4,5') return 'Lunes a viernes';
  if (s.join() === '6,0') return 'Fines de semana';
  return s.map((d) => DAY_SHORT[d]).join(', ');
}

/** Número visible del pedido ("#…" mientras el servidor lo asigna). */
export const orderNo = (o: { number: number }) => (o.number ? `#${o.number}` : '#…');
