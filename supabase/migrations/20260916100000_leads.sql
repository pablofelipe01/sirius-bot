-- Leads captados por el flujo guiado de WhatsApp (QR de ferias y eventos).
-- Una fila por número. `paso` guarda en qué pregunta va la conversación.
-- Igual que wa_mensajes: RLS activado sin políticas; solo el servidor entra con la service role key.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique,               -- número del cliente (sin +)
  nombre_perfil text,                       -- nombre del perfil de WhatsApp
  origen text,                              -- ej. 'conferencia_palma_2026'; null si no llegó por un QR conocido
  paso text not null default 'inicio',
  intentos_fallidos int not null default 0, -- respuestas inesperadas seguidas en el paso actual
  nombre text,
  empresa text,
  correo text,
  correo_sin_validar text,                  -- lo que escribió si el correo falló dos veces
  autoriza_datos_en timestamptz,            -- momento en que se mostró el aviso de Habeas Data y siguió
  etapa text check (etapa in ('areas_productivas', 'siembras_resiembras', 'viveros', 'varias')),
  hectareas text check (hectareas in ('hasta_50', '50_300', 'mas_300')),
  municipio text,
  departamento text,
  municipio_encontrado boolean,             -- true si coincidió con el listado del DANE
  fichas_enviadas_en timestamptz,
  correo_enviado_en timestamptz,
  requiere_asesor boolean not null default false,
  motivo_asesor text,
  completado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_requiere_asesor_idx on public.leads (requiere_asesor) where requiere_asesor;
create index leads_created_at_idx on public.leads (created_at desc);

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

alter table public.leads enable row level security;
