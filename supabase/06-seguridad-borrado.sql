-- La Tata Food: solo el administrador puede borrar pedidos (el resto del personal puede verlos y actualizarlos).
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
-- Requiere haber ejecutado antes los archivos 01 al 05.

drop policy if exists "personal pedidos" on public.orders;
drop policy if exists "personal ve pedidos" on public.orders;
drop policy if exists "personal crea pedidos" on public.orders;
drop policy if exists "personal actualiza pedidos" on public.orders;
drop policy if exists "admin borra pedidos" on public.orders;

create policy "personal ve pedidos" on public.orders
  for select to authenticated using (public.is_staff());
create policy "personal crea pedidos" on public.orders
  for insert to authenticated with check (public.is_staff());
create policy "personal actualiza pedidos" on public.orders
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admin borra pedidos" on public.orders
  for delete to authenticated using (public.is_admin());

-- Que Supabase reconozca al instante los cambios.
notify pgrst, 'reload schema';
