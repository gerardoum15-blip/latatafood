-- La Tata Food: refuerzo de seguridad del ingreso con código.
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
-- Requiere haber ejecutado antes los archivos 01 al 06.

-- 1) Freno más fuerte a quien pruebe códigos al azar:
--    por celular: 8 errores cada 10 min; en total (todos los celulares juntos): 20 errores cada 10 min.
create or replace function public.staff_login(p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_user text;
begin
  if auth.uid() is null then raise exception 'Sin sesión. Recarga la página.'; end if;
  delete from public.login_attempts where at < now() - interval '7 days';
  if (select count(*) from public.login_attempts where uid = auth.uid() and at > now() - interval '10 minutes') >= 8
     or (select count(*) from public.login_attempts where at > now() - interval '10 minutes') >= 20 then
    raise exception 'Demasiados intentos. Espera unos minutos.';
  end if;
  select user_id into v_user from public.staff_pins where active and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if v_user is null then
    insert into public.login_attempts (uid) values (auth.uid());
    return null;
  end if;
  insert into public.staff_sessions (uid, user_id) values (auth.uid(), v_user)
  on conflict (uid) do update set user_id = excluded.user_id, created_at = now();
  return v_user;
end $$;

-- 2) El código del Administrador debe tener 6 números (los demás, de 4 a 6).
create or replace function public.set_staff_pin(p_user text, p_pin text, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() and exists (select 1 from public.staff_pins) then
    raise exception 'Solo el administrador puede cambiar usuarios.';
  end if;
  if coalesce(p_pin, '') <> '' then
    if p_pin !~ '^\d{4,6}$' then raise exception 'El código debe tener de 4 a 6 números.'; end if;
    if p_role = 'admin' and length(p_pin) < 6 then raise exception 'El código del Administrador debe tener 6 números.'; end if;
    if exists (select 1 from public.staff_pins where active and user_id <> p_user and pin_hash = crypt(p_pin, pin_hash)) then
      raise exception 'Ese código ya lo usa otro usuario.';
    end if;
    insert into public.staff_pins (user_id, pin_hash, role, active)
    values (p_user, crypt(p_pin, gen_salt('bf')), p_role, p_active)
    on conflict (user_id) do update set pin_hash = excluded.pin_hash, role = excluded.role, active = excluded.active;
  else
    update public.staff_pins set role = p_role, active = p_active where user_id = p_user;
    if not found then raise exception 'Escribe un código para este usuario.'; end if;
  end if;
  if not p_active then delete from public.staff_sessions where user_id = p_user; end if;
end $$;

-- 3) Cerrar la sesión en todos los demás celulares (por si se pierde o roban uno).
create or replace function public.staff_logout_all() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Solo el administrador.'; end if;
  delete from public.staff_sessions where uid <> auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- 4) Resumen de seguridad para el administrador.
create or replace function public.security_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador.'; end if;
  return jsonb_build_object(
    'failed_24h', (select count(*) from public.login_attempts where at > now() - interval '24 hours'),
    'failed_1h', (select count(*) from public.login_attempts where at > now() - interval '1 hour'),
    'devices', (select count(*) from public.staff_sessions),
    'orders', (select count(*) from public.orders),
    'db_size_mb', round(pg_database_size(current_database()) / 1048576.0, 1)
  );
end $$;

revoke all on function public.staff_logout_all() from public, anon;
revoke all on function public.security_summary() from public, anon;
grant execute on function public.staff_logout_all() to authenticated;
grant execute on function public.security_summary() to authenticated;

notify pgrst, 'reload schema';
