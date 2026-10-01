-- Enlace del lead con su ficha en Sirius Clients Core (Airtable).
-- Es solo el rastro de la sincronización: el maestro de clientes sigue viviendo
-- en Airtable y el bot no lo lee para funcionar, así que si estas columnas
-- quedan vacías el flujo de WhatsApp se comporta igual que siempre.

alter table public.leads
  add column crm_cliente_record_id text,   -- record id de Airtable (recXXXX) en la tabla Clientes
  add column crm_cliente_id text,          -- serial legible que genera Airtable (CL-000X)
  add column crm_contacto_record_id text,  -- record id de la persona en Personal Cliente
  add column crm_sincronizado_en timestamptz,
  add column crm_error text;               -- último fallo, para verlo en el panel sin entrar a los logs

create index leads_crm_pendientes_idx on public.leads (created_at desc)
  where crm_cliente_record_id is null;
