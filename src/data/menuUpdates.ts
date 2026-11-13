import type { DB, ModifierGroup, Product } from '../types';

/** Gaseosa a elegir en los combos. */
export const COMBO_SODA_GROUP: ModifierGroup = {
  id: 'g-gaseosa-combo', name: 'Gaseosa', kind: 'single', required: true, max: 1, free: 0, freeTiers: [],
  options: [{ id: 'gc-inca', name: 'Inca Kola', price: 0 }, { id: 'gc-coca', name: 'Coca Cola', price: 0 }, { id: 'gc-pepsi', name: 'Pepsi', price: 0 }],
};

const ALITAS = ['g-salsa-alitas', 'g-alitas-pres', 'g-gaseosa-combo', 'g-cremas', 'g-salsas-extra'];
const LV = [1, 2, 3, 4, 5];
const combo = (id: string, name: string, price: number, description: string, badge?: string): Product => ({
  id, name, categoryId: 'c-combos', price, groupIds: ALITAS, localPrices: {}, active: true, description, days: LV, ...(badge ? { badge } : {}),
});

/** Combos de lunes a viernes (hasta agotar stock). */
export const WEEKDAY_COMBOS: Product[] = [
  combo('p-combo-personal', 'Combo Personal', 20, 'Para cuando no tienes con quién compartir. 6 piezas de alitas + papas fritas + 1 gaseosa 300 ml.'),
  combo('p-combo-dos', 'Combo para Dos', 30, 'Para cuando tienes mucha hambre o un plan. 12 piezas de alitas + 1 papas fritas grande + 2 gaseosas 300 ml.'),
  combo('p-combo-metiche', 'Combo La Metiche', 40, 'Para 3 a 4 personas, cuando llega una visita con hambre. 16 piezas de alitas + 1 papas fritas grande + 1 gaseosa 1 L.'),
  combo('p-combo-clasico', 'Combo Clásico', 49, 'Para 4 a 5 personas. 14 piezas de alitas + 8 piezas de strips + 1 papas fritas + 1 gaseosa 1.5 L.', 'Stock limitado'),
];

/** Agrega a la carta lo nuevo que aún no tenga (no toca lo que el administrador ya editó). */
export function applyMenuUpdates(d: DB): boolean {
  let changed = false;
  if (!d.groups.some((g) => g.id === COMBO_SODA_GROUP.id)) { d.groups.push(structuredClone(COMBO_SODA_GROUP)); changed = true; }
  const done = new Set(d.settings.menuUpdates ?? []);
  if (!done.has('combos-lv')) {
    for (const p of WEEKDAY_COMBOS) if (!d.products.some((x) => x.id === p.id)) d.products.push(structuredClone(p));
    d.settings.menuUpdates = [...done, 'combos-lv'];
    changed = true;
  }
  return changed;
}
