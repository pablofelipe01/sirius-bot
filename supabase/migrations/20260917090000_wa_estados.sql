-- Estados de entrega que Meta reporta por webhook para cada mensaje que envía el bot
-- (sent, delivered, read, failed). Sirve para saber por qué a un número no le llegan las respuestas.

create table public.wa_estados (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text not null,         -- id del mensaje enviado (wamid…)
  wa_id text not null,                 -- número del destinatario (sin +)
  estado text not null,                -- sent | delivered | read | failed
  error_codigo int,
  error_titulo text,
  error_detalle text,
  ocurrido_en timestamptz,             -- timestamp que reporta Meta
  created_at timestamptz not null default now()
);

create index wa_estados_wa_id_created_at_idx on public.wa_estados (wa_id, created_at desc);
create index wa_estados_fallidos_idx on public.wa_estados (created_at desc) where estado = 'failed';

-- Para cruzar el estado con el mensaje: id de Meta de las respuestas del bot.
alter table public.wa_mensajes add column wa_message_id_enviado text;

alter table public.wa_estados enable row level security;
