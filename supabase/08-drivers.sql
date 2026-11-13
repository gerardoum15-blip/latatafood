-- La Tata Food: un solo usuario "Driver" para todos los repartidores, y
-- solo el Mozo delivery puede confirmar o rechazar los pedidos que llegan desde la carta.
-- Al entrar, cada uno elige su nombre; la ubicación y el seguimiento usan ese nombre.
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
-- Requiere haber ejecutado antes los archivos 01 al 07.

-- 1) Guardar la ubicación a nombre del driver elegido (solo personal con código).
create or replace function public.update_my_location(p_lat double precision, p_lng double precision, p_accuracy double precision, p_heading double precision, p_speed double precision, p_driver text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user text := public.my_staff_user();
  v_id text;
begin
  if v_user is null then
    raise exception 'Ingresa con tu código para compartir la ubicación.';
  end if;
  v_id := coalesce(nullif(p_driver, ''), v_user);
  if length(v_id) > 64 then raise exception 'Driver no válido.'; end if;
  insert into public.driver_locations (user_id, lat, lng, accuracy, heading, speed, updated_at)
  values (v_id, p_lat, p_lng, p_accuracy, p_heading, p_speed, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
    heading = excluded.heading, speed = excluded.speed, updated_at = now();
end $$;

-- 2) Seguimiento del cliente: nombre del driver desde la lista de drivers (Usuarios > Drivers).
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
    'driver', coalesce(
      (select dr ->> 'name' from public.app_docs d, jsonb_array_elements(coalesce(d.data #> '{settings,drivers}', '[]'::jsonb)) dr
        where d.id = 'catalog' and dr ->> 'id' = o ->> 'driverId' limit 1),
      (select u ->> 'name' from public.app_docs d, jsonb_array_elements(d.data -> 'users') u
        where d.id = 'staff' and u ->> 'id' = o ->> 'driverId' limit 1)
    ),
    'location', v_loc
  );
end $$;

revoke all on function public.update_my_location(double precision, double precision, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.update_my_location(double precision, double precision, double precision, double precision, double precision, text) to authenticated;
revoke all on function public.track_order(text) from public;
grant execute on function public.track_order(text) to anon, authenticated;

-- 3) Pedidos web: todo el personal los ve, pero solo el Mozo delivery los confirma o rechaza.
create or replace function public.my_staff_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role from public.staff_sessions s join public.staff_pins p on p.user_id = s.user_id
  where s.uid = auth.uid() and p.active limit 1
$$;
revoke all on function public.my_staff_role() from public, anon;
grant execute on function public.my_staff_role() to authenticated;

drop policy if exists "personal pedidos web" on public.order_requests;
drop policy if exists "personal ve pedidos web" on public.order_requests;
drop policy if exists "mozo delivery valida pedidos web" on public.order_requests;
create policy "personal ve pedidos web" on public.order_requests
  for select to authenticated using (public.is_staff());
create policy "mozo delivery valida pedidos web" on public.order_requests
  for update to authenticated using (public.my_staff_role() = 'delivery') with check (public.my_staff_role() = 'delivery');

notify pgrst, 'reload schema';
