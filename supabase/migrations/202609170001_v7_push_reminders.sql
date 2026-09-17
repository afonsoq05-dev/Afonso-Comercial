create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.push_devices (
  device_id uuid primary key,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  timezone text not null default 'America/Sao_Paulo'
    check (char_length(timezone) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.push_schedules (
  device_id uuid not null references private.push_devices(device_id) on delete cascade,
  reminder_key text not null check (reminder_key ~ '^[0-9a-f]{64}$'),
  due_date date not null,
  notify_at timestamptz not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 300),
  target_url text not null default './?agenda=1'
    check (target_url = './?agenda=1'),
  sent_at timestamptz,
  sending_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (device_id, reminder_key)
);

create index if not exists push_schedules_due_unsent_idx
  on private.push_schedules (notify_at, device_id)
  where sent_at is null;

alter table private.push_devices enable row level security;
alter table private.push_devices force row level security;
alter table private.push_schedules enable row level security;
alter table private.push_schedules force row level security;

revoke all on all tables in schema private from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists push_devices_touch_updated_at on private.push_devices;
create trigger push_devices_touch_updated_at
before update on private.push_devices
for each row execute function private.touch_updated_at();

drop trigger if exists push_schedules_touch_updated_at on private.push_schedules;
create trigger push_schedules_touch_updated_at
before update on private.push_schedules
for each row execute function private.touch_updated_at();
