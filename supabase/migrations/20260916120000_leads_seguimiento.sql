-- Seguimiento de los asesores desde el panel /asesores.

alter table public.leads
  add column atendido_en timestamptz,   -- cuándo un asesor lo marcó como atendido
  add column atendido_por text,         -- nombre con el que entró el asesor al panel
  add column notas text;                -- notas internas del asesor

create index leads_atendido_en_idx on public.leads (atendido_en);
