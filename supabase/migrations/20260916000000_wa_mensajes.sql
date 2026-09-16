-- Historial de conversaciones de WhatsApp del bot Sirius.
-- El servidor accede con la service role key (que omite RLS); RLS queda
-- activado sin políticas para que las llaves públicas no puedan leerlo.

create table public.wa_mensajes (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null,                -- número del cliente (sin +)
  wa_message_id text unique,          -- id de Meta del mensaje entrante; evita procesar reintentos dos veces
  rol text not null check (rol in ('user', 'assistant')),
  contenido text not null,
  created_at timestamptz not null default now()
);

create index wa_mensajes_wa_id_created_at_idx on public.wa_mensajes (wa_id, created_at desc);

alter table public.wa_mensajes enable row level security;
