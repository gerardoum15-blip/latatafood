export type Role = 'admin' | 'cocina' | 'mozo' | 'delivery' | 'driver';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  cocina: 'Cocina',
  mozo: 'Mozo de tienda',
  delivery: 'Mozo delivery',
  driver: 'Driver (motorizado)',
};

export interface Local {
  id: string;
  name: string;
  tables: number;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  pin: string;
  /** Local fijo (obligatorio para cocina; opcional para el resto). */
  localId: string | null;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  order: number;
  /** Si sus platos llevan empaque en delivery (falso para bebidas). */
  packaging?: boolean;
}

export interface ModifierOption {
  id: string;
  name: string;
  price: number;
}

/**
 * single: elige una opción (ej. arroz dentro / aparte / sin arroz)
 * multi:  marca varias (ej. extras)
 * qty:    cantidades por opción (ej. cremas: 2 mayonesa, 1 ají)
 */
export type ModifierKind = 'single' | 'multi' | 'qty';

export interface ModifierGroup {
  id: string;
  name: string;
  kind: ModifierKind;
  required: boolean;
  /** Máximo total de selecciones (multi / qty). 0 = sin límite. */
  max: number;
  /** Cantidad incluida gratis (qty). Las adicionales se cobran al precio de cada opción. */
  free: number;
  /**
   * Gratis según el precio del plato (qty). Si tiene filas, reemplaza a `free`:
   * se usa la fila con el mayor `min` que sea <= precio del plato.
   */
  freeTiers: { min: number; free: number }[];
  /** Se elige una sola vez al final del pedido, para todos los platos (ej. cremas). */
  orderLevel?: boolean;
  /** Opción marcada por defecto (ej. "Sin arroz"). */
  defaultOptionId?: string;
  options: ModifierOption[];
}

export interface Product {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  /** Precio distinto por local (opcional). */
  localPrices: Record<string, number>;
  groupIds: string[];
  active: boolean;
  /** Lo que incluye el plato (se muestra en la carta del cliente). */
  description?: string;
  /** Etiqueta destacada, ej. "La más vendida". */
  badge?: string;
  /** Si lleva empaque en delivery. Vacío = lo que diga su categoría. */
  packaging?: boolean;
  /** Días disponibles (0 = domingo … 6 = sábado). Vacío = todos los días. */
  days?: number[];
}

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  qty: number;
  price: number; // precio total cobrado por esta línea
}

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  basePrice: number;
  unitPrice: number; // base + modificadores
  qty: number;
  modifiers: SelectedModifier[];
  note: string;
  round: number;
}

export type Channel = 'salon' | 'delivery';

export type KitchenStatus = 'enviado' | 'recibido' | 'preparando' | 'listo';
export type DeliveryStatus = 'pendiente' | 'en_camino' | 'llego' | 'entregado';

export const KITCHEN_LABEL: Record<KitchenStatus, string> = {
  enviado: 'Enviado a cocina',
  recibido: 'En preparación',
  preparando: 'En preparación',
  listo: 'Listo',
};

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  pendiente: 'Por salir',
  en_camino: 'En camino',
  llego: 'Llegó al cliente',
  entregado: 'Entregado',
};

export type PayMethod = 'efectivo' | 'yape' | 'plin' | 'tarjeta' | 'transferencia' | 'pagado';

export const PAY_LABEL: Record<PayMethod, string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  pagado: 'Ya pagado (adelantado)',
};

export interface Payment {
  method: PayMethod;
  amount: number;
}

export interface Customer {
  name: string;
  phone: string;
  address: string;
  reference: string;
  mapsUrl: string;
}

export interface StatusEvent {
  label: string;
  at: number;
  userId: string;
  userName: string;
}

export type SunatStatus = 'no_emitido' | 'emitido' | 'rechazado';

export interface Order {
  id: string;
  number: number;
  localId: string;
  channel: Channel;
  table: number | null;
  customer: Customer | null;
  deliveryFee: number;
  /** Cantidad de empaques cobrados y precio de cada uno. */
  packagingQty?: number;
  packagingPrice?: number;
  /** Delivery: forma de pago acordada con el cliente. */
  plannedPay: PayMethod | null;
  cashWith: number | null;
  driverId: string | null;
  items: OrderItem[];
  note: string;
  kitchenStatus: KitchenStatus;
  deliveryStatus: DeliveryStatus | null;
  served: boolean;
  closed: boolean;
  cancelled: boolean;
  payments: Payment[];
  createdAt: number;
  createdBy: string;
  createdByName: string;
  sentAt: number;
  readyAt: number | null;
  closedAt: number | null;
  history: StatusEvent[];
  sunat: { status: SunatStatus; type: 'boleta' | 'factura' | null };
}

/** Ticket (imagen) que se envía al cliente. */
export interface TicketSettings {
  /** Logo como imagen (data URL). Vacío = logo de La Tata Food. */
  logo: string;
  title: string;
  header: string;
  footer: string;
  showIgv: boolean;
  igvRate: number;
}

export interface Settings {
  ticket?: TicketSettings;
  businessName: string;
  whatsapp: string;
  packagingPrice: number;
  msgEnCamino: string;
  msgLlegue: string;
}

export interface DB {
  version: number;
  settings: Settings;
  locales: Local[];
  users: User[];
  categories: Category[];
  groups: ModifierGroup[];
  products: Product[];
  orders: Order[];
  counters: Record<string, number>;
}
