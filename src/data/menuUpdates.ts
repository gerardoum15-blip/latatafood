import type { DB, ModifierGroup, Product } from '../types';

/** Gaseosa a elegir en los combos. */
export const COMBO_SODA_GROUP: ModifierGroup = {
  id: 'g-gaseosa-combo', name: 'Gaseosa', kind: 'single', required: true, max: 1, free: 0, freeTiers: [],
  options: [{ id: 'gc-inca', name: 'Inca Kola', price: 0 }, { id: 'gc-coca', name: 'Coca Cola', price: 0 }, { id: 'gc-pepsi', name: 'Pepsi', price: 0 }],
};

const ALITAS = ['g-salsa-alitas', 'g-alitas-pres', 'g-cremas', 'g-salsas-extra'];
const LV = [1, 2, 3, 4, 5];
const combo = (id: string, name: string, price: number, description: string, badge?: string): Product => ({
  id, name, categoryId: 'c-combos', price, groupIds: ALITAS, localPrices: {}, active: true, description, days: LV, ...(badge ? { badge } : {}),
});

/** Combos de lunes a viernes (hasta agotar stock). */
export const WEEKDAY_COMBOS: Product[] = [
  combo('p-combo-personal', 'Combo Personal', 20, 'Para cuando no tienes con quién compartir. 6 piezas de alitas + papas fritas + 1 Pepsi 300 ml.'),
  combo('p-combo-dos', 'Combo para Dos', 30, 'Para cuando tienes mucha hambre o un plan. 12 piezas de alitas + 1 papas fritas grande + 2 Pepsi 300 ml.'),
  combo('p-combo-metiche', 'Combo La Metiche', 40, 'Para 3 a 4 personas, cuando llega una visita con hambre. 16 piezas de alitas + 1 papas fritas grande + 1 Pepsi 1 L.'),
  combo('p-combo-clasico', 'Combo Clásico', 49, 'Para 4 a 5 personas. 14 piezas de alitas + 8 piezas de strips + 1 papas fritas + 1 Pepsi 1.5 L.', 'Stock limitado'),
];

/** Agrega a la carta lo nuevo que aún no tenga (no toca lo que el administrador ya editó). */
type MenuPart = Pick<DB, 'groups' | 'products' | 'settings'>;

export function applyMenuUpdates(d: MenuPart): boolean {
  let changed = false;
  const done = new Set(d.settings.menuUpdates ?? []);
  if (!done.has('combos-lv')) {
    for (const p of WEEKDAY_COMBOS) if (!d.products.some((x) => x.id === p.id)) d.products.push(structuredClone(p));
    done.add('combos-lv');
    changed = true;
  }
  // Combos: todas las gaseosas son Pepsi del tamaño indicado (sin elegir).
  if (!done.has('combos-pepsi')) {
    for (const c of WEEKDAY_COMBOS) {
      const p = d.products.find((x) => x.id === c.id);
      if (p) { p.groupIds = p.groupIds.filter((g) => g !== COMBO_SODA_GROUP.id); p.description = c.description; }
    }
    d.groups = d.groups.filter((g) => g.id !== COMBO_SODA_GROUP.id || d.products.some((p) => p.groupIds.includes(g.id)));
    done.add('combos-pepsi');
    changed = true;
  }
  if (changed) d.settings.menuUpdates = [...done];
  return changed;
}

/** Carta recibida de la nube con lo nuevo ya incluido (solo en memoria; se guarda cuando entra el administrador). */
export function patchCatalog<T extends Partial<MenuPart>>(c: T): T {
  if (!c.products || !c.groups || !c.settings) return c;
  const copy = { ...c, products: [...c.products], groups: [...c.groups], settings: { ...c.settings } } as T & MenuPart;
  applyMenuUpdates(copy);
  // No se marca como aplicado: así, al entrar el administrador, se guarda en la nube.
  copy.settings.menuUpdates = c.settings.menuUpdates;
  return copy;
}
