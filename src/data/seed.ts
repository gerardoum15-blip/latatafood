import type { DB, ModifierGroup, Product } from '../types';

const opt = (id: string, name: string, price = 0) => ({ id, name, price });

/** Cremas gratis según el precio del plato. */
export const DEFAULT_CREAM_TIERS = [
  { min: 0, free: 4 },
  { min: 20, free: 6 },
  { min: 30, free: 8 },
  { min: 40, free: 10 },
  { min: 50, free: 12 },
];

const group = (g: Omit<ModifierGroup, 'freeTiers' | 'free' | 'max'> & Partial<Pick<ModifierGroup, 'freeTiers' | 'free' | 'max'>>): ModifierGroup => ({
  free: 0, max: 0, freeTiers: [], ...g,
});

const groups: ModifierGroup[] = [
  group({
    id: 'g-cremas', name: 'Cremas clásicas', kind: 'qty', required: false, orderLevel: true,
    freeTiers: DEFAULT_CREAM_TIERS,
    options: [opt('cr-mayo', 'Mayonesa', 0.5), opt('cr-ketchup', 'Ketchup', 0.5), opt('cr-mostaza', 'Mostaza', 0.5), opt('cr-rocoto', 'Rocoto', 0.5)],
  }),
  group({
    id: 'g-salsas-extra', name: 'Salsas especiales', kind: 'qty', required: false, orderLevel: true,
    options: [opt('se-acev-c', 'Acevichada clásica', 2), opt('se-acev-p', 'Acevichada picante', 2), opt('se-bbq-c', 'BBQ clásica', 2), opt('se-bbq-p', 'BBQ picante', 2)],
  }),
  group({
    id: 'g-salsa-alitas', name: 'Salsas (elige hasta 2)', kind: 'multi', required: true, max: 2,
    options: [opt('sa-acev-c', 'Acevichada clásica'), opt('sa-acev-p', 'Acevichada picante'), opt('sa-bbq-c', 'BBQ clásica'), opt('sa-bbq-p', 'BBQ picante')],
  }),
  group({
    id: 'g-alitas-pres', name: 'Presentación', kind: 'single', required: true, max: 1,
    options: [opt('al-banadas', 'Bañadas'), opt('al-aparte', 'Salsa aparte')],
  }),
  group({
    id: 'g-presa', name: 'Presa', kind: 'single', required: true, max: 1,
    options: [opt('pr-pecho', 'Pecho'), opt('pr-muslo', 'Muslo'), opt('pr-pierna', 'Pierna')],
  }),
  group({
    id: 'g-arroz', name: '¿Desea arroz dentro del plato?', kind: 'single', required: true, max: 1, defaultOptionId: 'ar-no',
    options: [opt('ar-si', 'Sí, por favor, incluido en el plato'), opt('ar-no', 'No, gracias, solo papas fritas')],
  }),
  group({
    id: 'g-ensalada', name: 'Ensalada (en frasco)', kind: 'single', required: true, max: 1, defaultOptionId: 'en-con',
    options: [opt('en-con', 'Con ensalada'), opt('en-sin', 'Sin ensalada')],
  }),
  group({
    id: 'g-ens-papas', name: '¿Con papas fritas dentro del táper?', kind: 'single', required: true, max: 1, defaultOptionId: 'ep-no',
    options: [opt('ep-si', 'Sí, con papas fritas (sin costo)'), opt('ep-no', 'No, solo ensalada')],
  }),
];

const CREMAS = ['g-cremas', 'g-salsas-extra'];
const ALITAS = ['g-salsa-alitas', 'g-alitas-pres', ...CREMAS];
const BROSTHER = ['g-arroz', 'g-ensalada', ...CREMAS];
const SALCHI = ['g-arroz', ...CREMAS];

let order = 0;
const p = (categoryId: string, name: string, price: number, groupIds: string[] = [], description = '', extra: Partial<Product> = {}): Product => ({
  id: `p-${++order}`, name, categoryId, price, groupIds, localPrices: {}, active: true, description, ...extra,
});

const HAMB = 'Incluye papas fritas, pan especial, lechuga y tomate, salsa tatera';
const ENS = 'Frasco personal de ensalada.';
const products: Product[] = [
  // Hamburguesas
  p('c-hamb', 'La Pudiente', 16, CREMAS, `Doble carne, doble queso y doble tocino. ${HAMB}.`),
  p('c-hamb', 'Royal Especial', 14, CREMAS, `Carne + tocino + queso + huevo frito. ${HAMB}.`),
  p('c-hamb', 'Chesseburguer', 12, CREMAS, `Carne + doble queso. ${HAMB}.`),
  p('c-hamb', 'La Carnosa', 10, CREMAS, `Carne de res artesanal para hamburguesa. ${HAMB}.`),
  p('c-hamb', 'La Fitnes', 10, CREMAS, `Pechuga de pollo a la plancha. ${HAMB}.`),
  p('c-hamb', 'Choripan Kids', 8, CREMAS, 'Pan con chorizo parrillero y papas fritas.'),
  // Brosther
  p('c-brosther', 'Brosther a lo pobre', 15, ['g-presa', 'g-ensalada', ...CREMAS], 'Presa broster (pecho, muslo o pierna) + arroz + plátano y huevo frito. Ensalada en frasco.'),
  p('c-brosther', 'Salchibrosther', 15, ['g-presa', ...BROSTHER], 'Presa broster (pecho, muslo o pierna) + hotdog + chorizo + huevo frito. Ensalada en frasco.'),
  p('c-brosther', 'Brosther especial · Doble ala', 16, BROSTHER, 'Doble ala broster + papas fritas + cremas clásicas. Ensalada en frasco.'),
  p('c-brosther', 'Brosther especial · Pecho sabroso', 12, BROSTHER, 'Pecho broster + papas fritas + cremas clásicas. Ensalada en frasco.'),
  p('c-brosther', 'Brosther especial · Pierna jugosa', 11, BROSTHER, 'Pierna broster + papas fritas + cremas clásicas. Ensalada en frasco.'),
  p('c-brosther', 'Brosther especial · Muslo atrevido', 11, BROSTHER, 'Muslo broster + papas fritas + cremas clásicas. Ensalada en frasco.'),
  p('c-brosther', 'Brosther especial · Alita crocante', 10, BROSTHER, 'Alita broster + papas fritas + cremas clásicas. Ensalada en frasco.'),
  // Alitas y piezas de pollo
  p('c-alitas', 'Alitas Extra (14 uds)', 35, ALITAS, '14 alitas + 1 papas fritas grande + hasta 2 salsas a elección.'),
  p('c-alitas', 'Alitas Grande (10 uds)', 25, ALITAS, '10 alitas + 1 papas fritas grande + hasta 2 salsas a elección.'),
  p('c-alitas', 'Alitas Personal (5 uds)', 15, ALITAS, '5 alitas y papas fritas + hasta 2 salsas a elección.'),
  p('c-alitas', 'Strips Grande (10 uds)', 25, ALITAS, '10 strips de pollo + 1 papas fritas grande + hasta 2 salsas a elección.'),
  // Salchipapas
  p('c-salchi', 'El Papirriqui', 18, SALCHI, 'Pechuga de pollo cubierta con queso + chorizo + hotdog + huevo frito. Como para 2 personas.', { badge: 'La más vendida' }),
  p('c-salchi', 'Salchicarnosa', 16, SALCHI, 'Hamburguesa de carne + tocino + chorizo + hotdog ahumado.'),
  p('c-salchi', 'Salchipizza', 16, SALCHI, 'Trozos de pechuga de pollo cubiertos con salsa de tomate y queso, con hotdog y chorizo. Incluye orégano.'),
  p('c-salchi', 'Salchipollo', 16, SALCHI, 'Trozos de filete de pechuga de pollo + tocino + chorizo + hotdog ahumado.'),
  p('c-salchi', 'Salchiclásica', 13, SALCHI, 'Hotdog + chorizo + huevo frito.'),
  p('c-salchi', 'Salchikids', 10, SALCHI, 'Hotdog ahumado con papas fritas.'),
  // Platos especiales
  p('c-especiales', 'Churrasco', 18, CREMAS, `Con papas fritas y arroz blanco. ${ENS}`),
  p('c-especiales', 'Arroz a la cubana', 12, CREMAS, `Con plátano y huevo frito, y papas fritas. ${ENS}`),
  p('c-especiales', 'Suprema de pollo', 13, CREMAS, `Con arroz y papas fritas. ${ENS}`),
  p('c-especiales', 'Doble suprema de pollo (plato XL)', 18, CREMAS, `Dos supremas con arroz y papas fritas. ${ENS}`),
  // Ensaladas Edward
  p('c-ensaladas', 'Edward con 1 pechuga de pollo', 12, ['g-ens-papas', ...CREMAS], 'Ensalada Edward con 1 pechuga de pollo. Papas fritas dentro del táper sin costo, si lo deseas.'),
  p('c-ensaladas', 'Edward con 2 pechugas de pollo', 16, ['g-ens-papas', ...CREMAS], 'Ensalada Edward con 2 pechugas de pollo. Papas fritas dentro del táper sin costo, si lo deseas.'),
  p('c-ensaladas', 'Edward con 3 pechugas de pollo', 20, ['g-ens-papas', ...CREMAS], 'Ensalada Edward con 3 pechugas de pollo. Papas fritas dentro del táper sin costo, si lo deseas.'),
  // Gaseosas y bebidas
  p('c-gaseosas', 'Coca Cola 600 ml', 4.5),
  p('c-gaseosas', 'Inca Kola 600 ml', 4.5),
  p('c-gaseosas', 'Pepsi 1.5 L', 6.5),
  p('c-gaseosas', 'Chicha Morada 1 L', 8),
  p('c-gaseosas', 'Maracuyá 1 L', 8),
  p('c-gaseosas', 'Manzana 1 L', 8),
  // Combos y promociones (todos los días)
  p('c-combos', 'Mixta Familiar (3 personas)', 35, ALITAS, '4 trozos de alitas + 4 trozos de strips + 2 piernitas especiales + 1 papas fritas grande.'),
  p('c-combos', 'Mega Familiar (6 personas)', 60, ALITAS, '10 trozos de alitas + 10 trozos de strips + 2 piernitas especiales + 2 papas fritas grande.'),
  // Adicionales
  p('c-adicionales', 'Porción de arroz', 4),
  p('c-adicionales', 'Ensalada personal', 3),
  p('c-adicionales', 'Ensalada mediana', 5),
  p('c-adicionales', 'Ensalada grande', 8),
  p('c-adicionales', 'Hotdog ahumado (dentro del plato)', 4),
  p('c-adicionales', 'Hotdog frankfurter (dentro del plato)', 8),
  p('c-adicionales', 'Chorizo parrillero (dentro del plato)', 4),
  p('c-adicionales', 'Papas fritas pequeña', 5, CREMAS),
  p('c-adicionales', 'Papas fritas grande', 8, CREMAS),
  p('c-adicionales', 'Papas fritas XL', 12, CREMAS),
];

export function createSeed(): DB {
  return {
    version: 2,
    settings: {
      businessName: 'La Tata Food',
      whatsapp: '955093657',
      packagingPrice: 0.5,
      msgEnCamino: 'Hola {cliente}, soy {driver} de {negocio}. Ya tengo tu pedido, estoy en camino a tu dirección.',
      msgLlegue: 'Hola {cliente}, ya llegué a tu ubicación. No demores en recoger tu pedido, por favor. Total: {total} ({pago}).',
    },
    locales: [
      { id: 'l-andahuaylas', name: 'Local Andahuaylas', tables: 12 },
      { id: 'l-praderas', name: 'Local Las Praderas', tables: 10 },
    ],
    users: [
      { id: 'u-admin', name: 'Administrador', role: 'admin', pin: '1234', localId: null, active: true },
      { id: 'u-coc-and', name: 'Cocina Andahuaylas', role: 'cocina', pin: '1111', localId: 'l-andahuaylas', active: true },
      { id: 'u-coc-pra', name: 'Cocina Las Praderas', role: 'cocina', pin: '2222', localId: 'l-praderas', active: true },
      { id: 'u-mozo1', name: 'Mozo de mesa', role: 'mozo', pin: '3333', localId: null, active: true },
      { id: 'u-deliv1', name: 'Mozo delivery', role: 'delivery', pin: '4444', localId: null, active: true },
      { id: 'u-driver1', name: 'Carlos Chunga', role: 'driver', pin: '5551', localId: null, active: true },
      { id: 'u-driver2', name: 'Dario Tesen', role: 'driver', pin: '5552', localId: null, active: true },
      { id: 'u-driver3', name: 'Arturo Urbina', role: 'driver', pin: '5553', localId: null, active: true },
    ],
    categories: [
      { id: 'c-hamb', name: 'Hamburguesas', order: 1 },
      { id: 'c-brosther', name: 'Brosther', order: 2 },
      { id: 'c-alitas', name: 'Piezas de alitas', order: 3 },
      { id: 'c-salchi', name: 'Salchipapas', order: 4 },
      { id: 'c-especiales', name: 'Platos especiales', order: 5 },
      { id: 'c-ensaladas', name: 'Ensaladas', order: 6 },
      { id: 'c-gaseosas', name: 'Gaseosas y bebidas', order: 7, packaging: false },
      { id: 'c-combos', name: 'Combos y promociones', order: 8 },
      { id: 'c-adicionales', name: 'Adicionales', order: 9, packaging: false },
    ],
    groups,
    products,
    orders: [],
    counters: {},
  };
}
