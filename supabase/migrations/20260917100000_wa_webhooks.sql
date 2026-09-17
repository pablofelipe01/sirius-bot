-- Registro crudo de cada webhook de Meta (diagnóstico). Contiene datos personales:
-- borrar filas viejas cuando ya no se necesiten (delete from wa_webhooks where created_at < now() - interval '30 days').

create table public.wa_webhooks (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  error text,                -- error al procesar ese webhook, si hubo
  created_at timestamptz not null default now()
);

create index wa_webhooks_created_at_idx on public.wa_webhooks (created_at desc);

alter table public.wa_webhooks enable row level security;
