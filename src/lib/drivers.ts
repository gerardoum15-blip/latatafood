import type { DB } from '../types';

/**
 * Drivers (personas que reparten). Entran con un solo usuario "driver" y en el celular eligen quién maneja.
 * Si el administrador aún no armó la lista, se toma de los usuarios con función driver.
 */
export interface DriverPerson { id: string; name: string; active: boolean }

export const driverList = (db: DB): DriverPerson[] =>
  db.settings.drivers ?? db.users.filter((u) => u.role === 'driver').map((u) => ({ id: u.id, name: u.name, active: u.active }));

export const activeDrivers = (db: DB) => driverList(db).filter((d) => d.active);

export const driverName = (db: DB, id: string | null | undefined) =>
  (id && (driverList(db).find((d) => d.id === id)?.name ?? db.users.find((u) => u.id === id)?.name)) || '';
