-- La Tata Food: el Administrador también puede confirmar o rechazar pedidos web (además del Mozo delivery).
-- Pegar completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
drop policy if exists "mozo delivery valida pedidos web" on public.order_requests;
create policy "mozo delivery valida pedidos web" on public.order_requests
  for update to authenticated using (public.my_staff_role() in ('delivery', 'admin')) with check (public.my_staff_role() in ('delivery', 'admin'));
notify pgrst, 'reload schema';
