-- La Tata Food: ingreso solo con PIN (sin clave del local).
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
-- Requiere haber ejecutado antes setup.sql.

create extension if not exists pgcrypto with schema extensions;

-- PIN de cada usuario, cifrado (nadie puede leerlo, ni siquiera la app).
create table if not exists public.staff_pins (
  user_id text primary key,
  pin_hash text not null,
  role text not null,
  active boolean not null default true
);

-- Celulares que ya ingresaron con un PIN válido.
create table if not exists public.staff_sessions (
  uid uuid primary key,
  user_id text not null,
  created_at timestamptz not null default now()
);

-- Intentos fallidos (para frenar a quien pruebe PIN al azar).
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  uid uuid,
  at timestamptz not null default now()
);

alter table public.staff_pins enable row level security;
alter table public.staff_sessions enable row level security;
alter table public.login_attempts enable row level security;
-- Sin políticas: estas tablas solo se usan desde las funciones de abajo.

-- Personal = el usuario antiguo de la clave del local, o un celular que ingresó con PIN válido.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'personal@latatafood.app'
      or exists (
        select 1 from public.staff_sessions s join public.staff_pins p on p.user_id = s.user_id
        where s.uid = auth.uid() and p.active
      )
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'personal@latatafood.app'
      or exists (
        select 1 from public.staff_sessions s join public.staff_pins p on p.user_id = s.user_id
        where s.uid = auth.uid() and p.active and p.role = 'admin'
      )
$$;

-- Ingresar con PIN. Devuelve el id del usuario, o null si el PIN es incorrecto.
create or replace function public.staff_login(p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_user text;
begin
  if auth.uid() is null then
    raise exception 'Sin sesión. Recarga la página.';
  end if;
  if (select count(*) from public.login_attempts where uid = auth.uid() and at > now() - interval '10 minutes') >= 8
     or (select count(*) from public.login_attempts where at > now() - interval '1 minute') >= 40 then
    raise exception 'Demasiados intentos. Espera unos minutos.';
  end if;
  select user_id into v_user from public.staff_pins
  where active and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if v_user is null then
    insert into public.login_attempts (uid) values (auth.uid());
    return null;
  end if;
  insert into public.staff_sessions (uid, user_id) values (auth.uid(), v_user)
  on conflict (uid) do update set user_id = excluded.user_id, created_at = now();
  return v_user;
end $$;

-- Usuario que tiene abierto este celular (o null).
create or replace function public.my_staff_user() returns text
language sql stable security definer set search_path = public as $$
  select s.user_id from public.staff_sessions s join public.staff_pins p on p.user_id = s.user_id
  where s.uid = auth.uid() and p.active
$$;

-- Salir: este celular deja de tener acceso hasta que alguien ingrese otro PIN.
create or replace function public.staff_logout() returns void
language sql security definer set search_path = public as $$
  delete from public.staff_sessions where uid = auth.uid()
$$;

-- Crear o cambiar el PIN, función o estado de un usuario (solo el administrador).
create or replace function public.set_staff_pin(p_user text, p_pin text, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() and exists (select 1 from public.staff_pins) then
    raise exception 'Solo el administrador puede cambiar usuarios.';
  end if;
  if coalesce(p_pin, '') <> '' then
    if p_pin !~ '^\d{4,6}$' then
      raise exception 'El PIN debe tener de 4 a 6 números.';
    end if;
    if exists (select 1 from public.staff_pins where active and user_id <> p_user and pin_hash = crypt(p_pin, pin_hash)) then
      raise exception 'Ese PIN ya lo usa otro usuario.';
    end if;
    insert into public.staff_pins (user_id, pin_hash, role, active)
    values (p_user, crypt(p_pin, gen_salt('bf')), p_role, p_active)
    on conflict (user_id) do update set pin_hash = excluded.pin_hash, role = excluded.role, active = excluded.active;
  else
    update public.staff_pins set role = p_role, active = p_active where user_id = p_user;
    if not found then
      raise exception 'Escribe un PIN para este usuario.';
    end if;
  end if;
  if not p_active then
    delete from public.staff_sessions where user_id = p_user;
  end if;
end $$;

revoke all on function public.staff_login(text) from public, anon;
revoke all on function public.my_staff_user() from public, anon;
revoke all on function public.staff_logout() from public, anon;
revoke all on function public.set_staff_pin(text, text, text, boolean) from public, anon;
grant execute on function public.staff_login(text) to authenticated;
grant execute on function public.my_staff_user() to authenticated;
grant execute on function public.staff_logout() to authenticated;
grant execute on function public.set_staff_pin(text, text, text, boolean) to authenticated;

-- Pasar los PIN actuales a la tabla cifrada y borrarlos de la lista visible.
insert into public.staff_pins (user_id, pin_hash, role, active)
select u ->> 'id', extensions.crypt(u ->> 'pin', extensions.gen_salt('bf')), u ->> 'role', coalesce((u ->> 'active')::boolean, true)
from public.app_docs d, jsonb_array_elements(d.data -> 'users') u
where d.id = 'staff' and coalesce(u ->> 'pin', '') <> ''
on conflict (user_id) do nothing;

update public.app_docs
set data = jsonb_set(data, '{users}', (select coalesce(jsonb_agg(u - 'pin'), '[]'::jsonb) from jsonb_array_elements(data -> 'users') u))
where id = 'staff';
