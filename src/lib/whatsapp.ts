/** Normaliza un número peruano a formato internacional sin "+" (ej. 51987654321). */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = '51' + d;
  return d;
}

/** WhatsApp daña los emojis "grandes" (fuera del plano básico) al abrir un chat desde un enlace: se quitan. */
export const safeWaText = (t: string) => t.replace(/ ?[\u{10000}-\u{10FFFF}]\uFE0F?/gu, '');

export function waLink(phone: string, text?: string) {
  const base = `https://wa.me/${normalizePhone(phone)}`;
  return text ? `${base}?text=${encodeURIComponent(safeWaText(text))}` : base;
}

/** Acepta solo enlaces web (evita pegar cualquier texto como ubicación). */
export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

export function fillTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** Enlace de Google Maps: usa el enlace pegado o busca por dirección. */
export function mapsLink(mapsUrl: string, address: string) {
  if (mapsUrl.trim()) return mapsUrl.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
