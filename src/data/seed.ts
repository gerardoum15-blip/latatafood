import type { DB, ModifierGroup, Product } from '../types';

const opt = (id: string, name: string, price = 0) => ({ id, name, price });

/** Cremas gratis según el precio del plato. */
export const DEFAULT_CREAM_TIERS = [
  { min: 0, free: 4 },
  { min: 20, free: 6 },
  { min: 30, free: 8 },
  { min: 40, free: 10 },
];

const group = (g: Omit<ModifierGroup, 'freeTiers' | 'free' | 'max'> & Partial<Pick<ModifierGroup, 'freeTiers' | 'free' | 'max'>>): ModifierGroup => ({
  free: 0, max: 0, freeTiers: [], ...g,
});

const groups: ModifierGroup[] = [
  group({
    id: 'g-cremas', name: 'Cremas clásicas', kind: 'qty', required: false,
    freeTiers: DEFAULT_CREAM_TIERS,
    options: [opt('cr-mayo', 'Mayonesa', 0.5), opt('cr-ketchup', 'Ketchup', 0.5), opt('cr-mostaza', 'Mostaza', 0.5), opt('cr-rocoto', 'Rocoto', 0.5)],
  }),
  group({
    id: 'g-salsas-extra', name: 'Salsas especiales', kind: 'qty', required: false,
    options: [opt('se-acev-c', 'Acevichada clásica', 2), opt('se-acev-p', 'Acevichada picante', 2), opt('se-bbq-c', 'BBQ clásica', 2), opt('se-bbq-p', 'BBQ picante', 2)],
  }),
  group({
    id: 'g-salsa-alitas', name: 'Salsa (incluida)', kind: 'single', required: true, max: 1,
    options: [opt('sa-acev-c', 'Acevichada clásica'), opt('sa-acev-p', 'Acevichada picante'), opt('sa-bbq-c', 'BBQ clásica'), opt('sa-bbq-p', 'BBQ picante')],
  }),
  group({
    id: 'g-alitas-pres', name: 'Presentación', kind: 'single', required: true, max: 1,
    options: [opt('al-banadas', 'Bañadas'), opt('al-aparte', 'Salsa aparte')],
  }),
  group({
    id: 'g-arroz', name: 'Arroz blanco', kind: 'single', required: true, max: 1,
    options: [opt('ar-sin', 'Sin arroz'), opt('ar-dentro', 'Dentro del plato'), opt('ar-aparte', 'Aparte')],
  }),
  group({
    id: 'g-ensalada', name: 'Ensalada (en frasco)', kind: 'single', required: true, max: 1,
    options: [opt('en-con', 'Con ensalada'), opt('en-sin', 'Sin ensalada')],
  }),
];

const CREMAS = ['g-cremas', 'g-salsas-extra'];
const ALITAS = ['g-salsa-alitas', 'g-alitas-pres', 'g-cremas', 'g-salsas-extra'];

let order = 0;
const p = (categoryId: string, name: string, price: number, groupIds: string[] = []): Product => ({
  id: `p-${++order}`, name, categoryId, price, groupIds, localPrices: {}, active: true,
});

const products: Product[] = [
  // Hamburguesas (todas incluyen papas fritas)
  p('c-hamb', 'La Pudiente', 16, CREMAS),
  p('c-hamb', 'Royal Especial', 14, CREMAS),
  p('c-hamb', 'Chesseburguer', 12, CREMAS),
  p('c-hamb', 'La Carnosa', 10, CREMAS),
  p('c-hamb', 'La Fitnes', 10, CREMAS),
  p('c-hamb', 'Choripan Kids', 8, CREMAS),
  // Brosther
  p('c-brosther', 'Brosther a lo pobre · Pecho', 15, ['g-arroz', 'g-ensalada', ...CREMAS]),
  p('c-brosther', 'Brosther a lo pobre · Doble ala', 18, ['g-arroz', 'g-ensalada', ...CREMAS]),
  p('c-brosther', 'Salchibrosther · Pecho', 15, ['g-arroz', 'g-ensalada', ...CREMAS]),
  p('c-brosther', 'Salchibrosther · Doble ala', 18, ['g-arroz', 'g-ensalada', ...CREMAS]),
  p('c-brosther', 'Brosther especial · Pecho sabroso', 12, ['g-arroz', 'g-ensalada', ...CREMAS]),
  p('c-brosther', 'Brosther especial · Pierna jugosa', 11, ['g-arroz', 'g-ensalada', ...CREMAS]),
  p('c-brosther', 'Brosther especial · Muslo atrevido', 11, ['g-arroz', 'g-ensalada', ...CREMAS]),
  p('c-brosther', 'Brosther especial · Alita crocante', 10, ['g-arroz', 'g-ensalada', ...CREMAS]),
  // Alitas y piezas de pollo (incluye papas fritas + salsa de su preferencia)
  p('c-alitas', 'Alitas Extra (14 uds)', 35, ALITAS),
  p('c-alitas', 'Alitas Grande (10 uds)', 25, ALITAS),
  p('c-alitas', 'Alitas Personal (5 uds)', 15, ALITAS),
  p('c-alitas', 'Strips Grande (10 uds)', 25, ['g-salsa-alitas', 'g-cremas', 'g-salsas-extra']),
  // Salchipapas (no incluye ensalada)
  p('c-salchi', 'El Papirriqui', 18, ['g-arroz', ...CREMAS]),
  p('c-salchi', 'Salchicarnosa', 16, ['g-arroz', ...CREMAS]),
  p('c-salchi', 'Salchipizza', 16, ['g-arroz', ...CREMAS]),
  p('c-salchi', 'Salchipollo', 16, ['g-arroz', ...CREMAS]),
  p('c-salchi', 'Salchiclásica', 13, ['g-arroz', ...CREMAS]),
  p('c-salchi', 'Salchikids', 10, ['g-arroz', ...CREMAS]),
  // Platos especiales
  p('c-especiales', 'Churrasco a lo pobre', 16, CREMAS),
  p('c-especiales', 'Arroz a la cubana + ensalada', 10, CREMAS),
  // Ensaladas
  p('c-ensaladas', 'Ensalada + 1 filete de pollo', 12, CREMAS),
  p('c-ensaladas', 'Ensalada + 2 filetes de pollo', 16, CREMAS),
  // Gaseosas y bebidas
  p('c-gaseosas', 'Coca Cola 600 ml', 4),
  p('c-gaseosas', 'Inca Kola 600 ml', 4),
  p('c-gaseosas', 'Pepsi 1.5 L', 6.5),
  p('c-gaseosas', 'Chicha Morada 1 L', 8),
  p('c-gaseosas', 'Maracuyá 1 L', 8),
  // Combos y promociones
  p('c-combos', 'Mixta Familiar (3 personas)', 35, ALITAS),
  p('c-combos', 'Mega Familiar (6 personas)', 60, ALITAS),
  // Adicionales
  p('c-adicionales', 'Papas fritas grande', 10, CREMAS),
  p('c-adicionales', 'Papas fritas XL', 12, CREMAS),
  p('c-adicionales', 'Arroz blanco', 4),
  p('c-adicionales', 'Hotdog ahumado', 4),
];

export function createSeed(): DB {
  return {
    version: 2,
    settings: {
      businessName: 'La Tata Food',
      whatsapp: '955093657',
      msgEnCamino: 'Hola {cliente}, soy {driver} de {negocio} 🛵. Ya tengo tu pedido, estoy en camino a tu dirección.',
      msgLlegue: 'Hola {cliente}, ya llegué a tu ubicación 📍. No demores en recoger tu pedido, por favor. Total: {total} ({pago}).',
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
      { id: 'c-gaseosas', name: 'Gaseosas y bebidas', order: 7 },
      { id: 'c-combos', name: 'Combos y promociones', order: 8 },
      { id: 'c-adicionales', name: 'Adicionales', order: 9 },
    ],
    groups,
    products,
    orders: [],
    counters: {},
  };
}
