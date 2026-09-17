-- WhatsApp usernames: Meta puede enviar el mensaje sin número de teléfono, solo con el
-- business-scoped user ID (BSUID, ej. "CO.1060922963236286"). En ese caso leads.wa_id guarda el BSUID.

alter table public.leads
  add column user_id text,    -- BSUID de la persona (siempre viene en los webhooks)
  add column username text;   -- nombre de usuario de WhatsApp, si lo activó

create unique index leads_user_id_key on public.leads (user_id) where user_id is not null;

-- Los estados de un mensaje enviado a un BSUID pueden no traer número.
alter table public.wa_estados alter column wa_id drop not null;
