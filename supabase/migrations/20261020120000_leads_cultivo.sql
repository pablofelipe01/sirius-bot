-- Pregunta abierta del flujo guiado: "¿Qué cultivo tienes?" (texto tal como lo escribe la persona).

alter table public.leads
  add column cultivo text;
