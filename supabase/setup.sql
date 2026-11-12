-- La Tata Food: tablas, seguridad y tiempo real.
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.

-- Solo el usuario del personal puede leer y escribir pedidos y usuarios.
create or replace function public.is_staff() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'personal@latatafood.app'
$$;

-- Carta y ajustes ('catalog', lectura pública) y usuarios del personal ('staff', privado).
create table if not exists public.app_docs (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Pedidos (un registro por pedido).
create table if not exists public.orders (
  id text primary key,
  local_id text not null,
  created_at timestamptz not null default now(),
  version integer not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- Numeración de pedidos por local, sin repetidos.
create table if not exists public.order_counters (
  local_id text primary key,
  last_number integer not null default 0
);

alter table public.app_docs enable row level security;
alter table public.orders enable row level security;
alter table public.order_counters enable row level security;

drop policy if exists "carta publica" on public.app_docs;
create policy "carta publica" on public.app_docs
  for select to anon, authenticated using (id = 'catalog');

drop policy if exists "personal docs" on public.app_docs;
create policy "personal docs" on public.app_docs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "personal pedidos" on public.orders;
create policy "personal pedidos" on public.orders
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.next_order_number(p_local text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_staff() then
    raise exception 'no autorizado';
  end if;
  insert into public.order_counters (local_id, last_number) values (p_local, 1)
  on conflict (local_id) do update set last_number = public.order_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;
revoke all on function public.next_order_number(text) from public, anon;
grant execute on function public.next_order_number(text) to authenticated;

-- Tiempo real: avisar a todos los celulares cuando cambia un pedido o la carta.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'app_docs') then
    alter publication supabase_realtime add table public.app_docs;
  end if;
end $$;
