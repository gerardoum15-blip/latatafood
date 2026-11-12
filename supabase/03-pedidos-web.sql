-- La Tata Food: pedidos que envían los clientes desde la carta (#carta).
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
-- Requiere haber ejecutado antes setup.sql y 02-ingreso-con-pin.sql.

create table if not exists public.order_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  uid uuid,
  status text not null default 'pendiente', -- pendiente | aceptado | rechazado
  data jsonb not null,
  handled_by text,
  handled_at timestamptz,
  order_id text,
  reason text
);
create index if not exists order_requests_created_idx on public.order_requests (created_at desc);

alter table public.order_requests enable row level security;

-- Solo el personal ve y atiende los pedidos web. Los clientes solo pueden enviarlos (con la función de abajo).
drop policy if exists "personal pedidos web" on public.order_requests;
create policy "personal pedidos web" on public.order_requests
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Enviar un pedido desde la carta. Límite para evitar abusos: 5 por cliente cada 10 minutos.
create or replace function public.submit_order_request(p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sin sesión. Recarga la página.';
  end if;
  if octet_length(p_data::text) > 30000 then
    raise exception 'Pedido demasiado grande.';
  end if;
  if coalesce(p_data #>> '{customer,name}', '') = '' or coalesce(p_data #>> '{customer,phone}', '') = '' then
    raise exception 'Faltan nombre o WhatsApp.';
  end if;
  if (select count(*) from public.order_requests where uid = auth.uid() and created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.order_requests where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Demasiados pedidos seguidos. Espera unos minutos o escríbenos por WhatsApp.';
  end if;
  insert into public.order_requests (uid, data) values (auth.uid(), p_data) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.submit_order_request(jsonb) from public, anon;
grant execute on function public.submit_order_request(jsonb) to authenticated;

-- Avisar al instante a los celulares del personal.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_requests') then
    alter publication supabase_realtime add table public.order_requests;
  end if;
end $$;
