drop policy if exists push_devices_no_client_access on private.push_devices;
create policy push_devices_no_client_access
on private.push_devices
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists push_schedules_no_client_access on private.push_schedules;
create policy push_schedules_no_client_access
on private.push_schedules
for all
to anon, authenticated
using (false)
with check (false);

comment on table private.push_devices is
  'Assinaturas Web Push privadas. Acesso somente pelas Edge Functions com autenticação própria.';

comment on table private.push_schedules is
  'Agenda mínima de notificações. A carteira comercial completa nunca é armazenada aqui.';
