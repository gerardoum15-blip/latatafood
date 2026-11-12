-- La Tata Food: ubicación en tiempo real de los drivers y seguimiento del pedido con enlace.
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
-- Requiere haber ejecutado antes los archivos 01 (setup.sql) al 04.

-- Última ubicación de cada driver (una fila por driver).
create table if not exists public.driver_locations (
  user_id text primary key,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  heading double precision,
  speed double precision,
  updated_at timestamptz not null default now()
);
alter table public.driver_locations enable row level security;

-- Solo el personal ve las ubicaciones. Escribir solo con la función de abajo.
drop policy if exists "personal ve ubicaciones" on public.driver_locations;
create policy "personal ve ubicaciones" on public.driver_locations
  for select to authenticated using (public.is_staff());

-- El celular del driver envía su propia ubicación (solo la suya).
create or replace function public.update_my_location(p_lat double precision, p_lng double precision, p_accuracy double precision, p_heading double precision, p_speed double precision)
returns void language plpgsql security definer set search_path = public as $$
declare v_user text := public.my_staff_user();
begin
  if v_user is null then
    raise exception 'Ingresa con tu código para compartir la ubicación.';
  end if;
  insert into public.driver_locations (user_id, lat, lng, accuracy, heading, speed, updated_at)
  values (v_user, p_lat, p_lng, p_accuracy, p_heading, p_speed, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
    heading = excluded.heading, speed = excluded.speed, updated_at = now();
end $$;

-- Seguimiento para el cliente: con el código del pedido web (uuid) o el código del pedido.
-- La ubicación del driver solo se muestra mientras el pedido está en camino.
create or replace function public.track_order(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.order_requests;
  o jsonb;
  v_mode text;
  v_loc jsonb := null;
begin
  if p_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into r from public.order_requests where id = p_ref::uuid;
    if not found then return null; end if;
    select data into o from public.orders where id = r.order_id;
    v_mode := r.data ->> 'mode';
  else
    select data into o from public.orders where id = p_ref;
    if o is null then return null; end if;
    v_mode := case
      when o ->> 'channel' = 'salon' then 'mesa'
      when coalesce(o #>> '{customer,address}', '') ilike 'recojo%' then 'recojo'
      else 'delivery' end;
  end if;

  if o is not null and o ->> 'deliveryStatus' in ('en_camino', 'llego') then
    select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'updated_at', l.updated_at) into v_loc
    from public.driver_locations l where l.user_id = o ->> 'driverId';
  end if;

  return jsonb_build_object(
    'status', coalesce(r.status, case when o is null then 'pendiente' else 'aceptado' end),
    'reason', r.reason,
    'mode', v_mode,
    'number', (o ->> 'number')::integer,
    'kitchen', o ->> 'kitchenStatus',
    'delivery', o ->> 'deliveryStatus',
    'served', coalesce((o ->> 'served')::boolean, false),
    'closed', coalesce((o ->> 'closed')::boolean, false),
    'cancelled', coalesce((o ->> 'cancelled')::boolean, false),
    'driver', (
      select u ->> 'name' from public.app_docs d, jsonb_array_elements(d.data -> 'users') u
      where d.id = 'staff' and u ->> 'id' = o ->> 'driverId' limit 1
    ),
    'location', v_loc
  );
end $$;

revoke all on function public.update_my_location(double precision, double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.update_my_location(double precision, double precision, double precision, double precision, double precision) to authenticated;
revoke all on function public.track_order(text) from public;
grant execute on function public.track_order(text) to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'driver_locations') then
    alter publication supabase_realtime add table public.driver_locations;
  end if;
end $$;
