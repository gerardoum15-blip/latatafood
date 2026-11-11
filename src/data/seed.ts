import type { DB, ModifierGroup, Product } from '../types';

const opt = (id: string, name: string, price = 0) => ({ id, name, price });

const groups: ModifierGroup[] = [
  {
    id: 'g-cremas', name: 'Cremas', kind: 'qty', required: false, max: 6, free: 3,
    options: [opt('cr-mayo', 'Mayonesa', 0.5), opt('cr-ketchup', 'Ketchup', 0.5), opt('cr-mostaza', 'Mostaza', 0.5), opt('cr-aji', 'Ají', 0.5), opt('cr-golf', 'Golf', 0.5), opt('cr-tartara', 'Tártara', 0.5)],
  },
  {
    id: 'g-arroz', name: 'Arroz', kind: 'single', required: true, max: 1, free: 0,
    options: [opt('ar-dentro', 'Dentro del plato'), opt('ar-aparte', 'Aparte'), opt('ar-sin', 'Sin arroz')],
  },
  {
    id: 'g-ensalada', name: 'Ensalada', kind: 'single', required: true, max: 1, free: 0,
    options: [opt('en-con', 'Con ensalada'), opt('en-sin', 'Sin ensalada'), opt('en-aparte', 'Ensalada aparte')],
  },
  {
    id: 'g-alitas-pres', name: 'Presentación de alitas', kind: 'single', required: true, max: 1, free: 0,
    options: [opt('al-banadas', 'Bañadas'), opt('al-aparte', 'Salsa aparte')],
  },
  {
    id: 'g-alitas-salsa', name: 'Salsa de alitas', kind: 'single', required: true, max: 1, free: 0,
    options: [opt('sa-bbq', 'BBQ'), opt('sa-acevichada', 'Acevichada'), opt('sa-buffalo', 'Buffalo picante'), opt('sa-maracuya', 'Maracuyá'), opt('sa-honey', 'Honey mustard'), opt('sa-teriyaki', 'Teriyaki')],
  },
  {
    id: 'g-papas', name: 'Acompañamiento', kind: 'single', required: true, max: 1, free: 0,
    options: [opt('pa-fritas', 'Papas fritas'), opt('pa-camote', 'Camote frito', 1), opt('pa-sin', 'Sin acompañamiento')],
  },
  {
    id: 'g-extras', name: 'Extras', kind: 'multi', required: false, max: 0, free: 0,
    options: [opt('ex-huevo', 'Huevo frito', 2), opt('ex-platano', 'Plátano frito', 2.5), opt('ex-queso', 'Queso', 2)],
  },
  {
    id: 'g-bebida-temp', name: 'Temperatura', kind: 'single', required: true, max: 1, free: 0,
    options: [opt('te-helada', 'Helada'), opt('te-natural', 'Al tiempo')],
  },
];

const p = (id: string, name: string, categoryId: string, price: number, groupIds: string[] = []): Product => ({
  id, name, categoryId, price, groupIds, localPrices: {}, active: true,
});

const products: Product[] = [
  p('p-alitas6', 'Alitas x6', 'c-alitas', 18, ['g-alitas-pres', 'g-alitas-salsa', 'g-papas', 'g-cremas']),
  p('p-alitas12', 'Alitas x12', 'c-alitas', 32, ['g-alitas-pres', 'g-alitas-salsa', 'g-papas', 'g-cremas']),
  p('p-broaster', 'Pollo broaster (pecho)', 'c-pollo', 16, ['g-papas', 'g-arroz', 'g-ensalada', 'g-cremas']),
  p('p-broaster-pierna', 'Pollo broaster (pierna)', 'c-pollo', 15, ['g-papas', 'g-arroz', 'g-ensalada', 'g-cremas']),
  p('p-salchi', 'Salchipapa clásica', 'c-pollo', 12, ['g-cremas', 'g-extras']),
  p('p-lomo', 'Lomo saltado', 'c-fondos', 25, ['g-arroz', 'g-extras']),
  p('p-chaufa', 'Arroz chaufa de pollo', 'c-fondos', 18, ['g-extras', 'g-cremas']),
  p('p-milanesa', 'Milanesa de pollo', 'c-fondos', 20, ['g-papas', 'g-arroz', 'g-ensalada', 'g-cremas']),
  p('p-inca', 'Inca Kola 500 ml', 'c-bebidas', 4, ['g-bebida-temp']),
  p('p-coca', 'Coca Cola 500 ml', 'c-bebidas', 4, ['g-bebida-temp']),
  p('p-chicha', 'Chicha morada (jarra)', 'c-bebidas', 12),
  p('p-limonada', 'Limonada frozen', 'c-bebidas', 8),
];

export function createSeed(): DB {
  return {
    version: 1,
    settings: {
      businessName: 'Mi Restaurante',
      msgRecogido: 'Hola {cliente} 👋, tu pedido #{numero} de {negocio} ya está listo y lo recogió nuestro motorizado {driver}. ¡En breve sale hacia tu dirección!',
      msgEnCamino: 'Hola {cliente}, tu pedido #{numero} de {negocio} está en camino 🛵. Total a pagar: {total} ({pago}).',
      msgEntregado: '¡Gracias por tu compra, {cliente}! 🙌 Tu pedido #{numero} de {negocio} fue entregado. ¡Buen provecho!',
    },
    locales: [
      { id: 'l-andahuaylas', name: 'Local Andahuaylas', tables: 12 },
      { id: 'l-praderas', name: 'Local Las Praderas', tables: 10 },
    ],
    users: [
      { id: 'u-admin', name: 'Administrador', role: 'admin', pin: '1234', localId: null, active: true },
      { id: 'u-coc-and', name: 'Cocina Andahuaylas', role: 'cocina', pin: '1111', localId: 'l-andahuaylas', active: true },
      { id: 'u-coc-pra', name: 'Cocina Las Praderas', role: 'cocina', pin: '2222', localId: 'l-praderas', active: true },
      { id: 'u-mozo1', name: 'Mozo Carlos', role: 'mozo', pin: '3333', localId: null, active: true },
      { id: 'u-deliv1', name: 'Delivery Ana', role: 'delivery', pin: '4444', localId: null, active: true },
      { id: 'u-driver1', name: 'Driver Luis', role: 'driver', pin: '5555', localId: null, active: true },
      { id: 'u-driver2', name: 'Driver Jorge', role: 'driver', pin: '6666', localId: null, active: true },
    ],
    categories: [
      { id: 'c-alitas', name: 'Alitas', order: 1 },
      { id: 'c-pollo', name: 'Broaster y salchipapas', order: 2 },
      { id: 'c-fondos', name: 'Platos de fondo', order: 3 },
      { id: 'c-bebidas', name: 'Bebidas', order: 4 },
    ],
    groups,
    products,
    orders: [],
    counters: {},
  };
}
