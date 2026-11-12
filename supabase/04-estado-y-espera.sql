-- La Tata Food: tiempo de espera según cocina y estado del pedido para el cliente.
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
-- Requiere haber ejecutado antes setup.sql, 02-ingreso-con-pin.sql y 03-pedidos-web.sql.

-- Cuántos pedidos hay ahora en cocina (sin datos de clientes: solo el número).
create or replace function public.kitchen_queue() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.orders
  where created_at > now() - interval '12 hours'
    and coalesce((data ->> 'cancelled')::boolean, false) = false
    and data ->> 'kitchenStatus' in ('enviado', 'recibido', 'preparando')
$$;

-- Estado de un pedido web, para que el cliente lo siga desde la carta.
-- Solo responde a quien conoce el código del pedido (no se puede adivinar).
create or replace function public.order_request_status(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', r.status,
    'reason', r.reason,
    'mode', r.data ->> 'mode',
    'number', (o.data ->> 'number')::integer,
    'kitchen', o.data ->> 'kitchenStatus',
    'delivery', o.data ->> 'deliveryStatus',
    'served', coalesce((o.data ->> 'served')::boolean, false),
    'closed', coalesce((o.data ->> 'closed')::boolean, false),
    'cancelled', coalesce((o.data ->> 'cancelled')::boolean, false),
    'driver', (
      select u ->> 'name' from public.app_docs d, jsonb_array_elements(d.data -> 'users') u
      where d.id = 'staff' and u ->> 'id' = o.data ->> 'driverId' limit 1
    )
  )
  from public.order_requests r
  left join public.orders o on o.id = r.order_id
  where r.id = p_id
$$;

revoke all on function public.kitchen_queue() from public;
revoke all on function public.order_request_status(uuid) from public;
grant execute on function public.kitchen_queue() to anon, authenticated;
grant execute on function public.order_request_status(uuid) to anon, authenticated;

-- Que el pedido web devuelva su código al cliente (ya lo hace submit_order_request).
