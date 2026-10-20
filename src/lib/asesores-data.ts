import { ETAPAS, HECTAREAS, NOMBRE_PASO, ORIGENES } from "@/config/flujo";
import { configCrm, listoParaCrm, sincronizarLead } from "./crm";
import { normalize } from "./municipios";
import { getSupabaseAdmin, type Lead } from "./store";

// Lectura y escritura de leads para el panel de asesores. Solo servidor.

export type LeadConId = Lead & { id: string; created_at: string; updated_at: string };

export type Estado = "atendido" | "asesor" | "completo" | "solo_fichas" | "en_curso";

export const VISTAS = [
  { id: "por_atender", titulo: "Por atender" },
  { id: "en_curso", titulo: "En curso" },
  { id: "atendidos", titulo: "Atendidos" },
  { id: "todos", titulo: "Todos" },
] as const;

export type Vista = (typeof VISTAS)[number]["id"];

export function estadoDe(lead: Lead): Estado {
  if (lead.atendido_en) return "atendido";
  if (lead.requiere_asesor) return "asesor";
  if (lead.completado_en) return "completo";
  if (lead.paso === "completo") return "solo_fichas";
  return "en_curso";
}

export const ESTADO_TEXTO: Record<Estado, string> = {
  asesor: "Pidió asesor",
  completo: "Completó",
  solo_fichas: "Solo fichas",
  en_curso: "En curso",
  atendido: "Atendido",
};

function enVista(lead: Lead, vista: Vista): boolean {
  const estado = estadoDe(lead);
  switch (vista) {
    case "por_atender":
      return estado === "asesor" || estado === "completo" || estado === "solo_fichas";
    case "en_curso":
      return estado === "en_curso";
    case "atendidos":
      return estado === "atendido";
    case "todos":
      return true;
  }
}

// Orden dentro de "Por atender": primero quien pidió asesor, luego quien completó, luego solo fichas.
const PRIORIDAD: Record<Estado, number> = { asesor: 0, completo: 1, solo_fichas: 2, en_curso: 3, atendido: 4 };

function db() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  return client;
}

export async function listarLeads(vista: Vista, busqueda: string) {
  const { data, error } = await db().from("leads").select("*").order("created_at", { ascending: false }).limit(2000);
  if (error) throw error;
  const todos = data as LeadConId[];

  const conteos = Object.fromEntries(VISTAS.map((v) => [v.id, todos.filter((l) => enVista(l, v.id)).length])) as Record<
    Vista,
    number
  >;

  const q = normalize(busqueda);
  let leads = todos.filter((l) => enVista(l, vista));
  if (q) {
    leads = leads.filter((l) =>
      normalize([l.nombre, l.nombre_perfil, l.username, l.empresa, l.municipio, l.departamento, l.correo, l.wa_id].join(" ")).includes(q),
    );
  }
  if (vista === "por_atender") {
    leads.sort((a, b) => PRIORIDAD[estadoDe(a)] - PRIORIDAD[estadoDe(b)]);
  }
  return { leads, conteos, total: todos.length };
}

export async function todosLosLeads(): Promise<LeadConId[]> {
  const { data, error } = await db().from("leads").select("*").order("created_at", { ascending: false }).limit(10000);
  if (error) throw error;
  return data as LeadConId[];
}

export async function obtenerLead(id: string): Promise<LeadConId | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db().from("leads").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as LeadConId | null;
}

export async function conversacion(waId: string) {
  const { data, error } = await db()
    .from("wa_mensajes")
    .select("id, rol, contenido, created_at")
    .eq("wa_id", waId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw error;
  return data as { id: string; rol: "user" | "assistant"; contenido: string; created_at: string }[];
}

export async function actualizarSeguimiento(
  id: string,
  cambios: { atendido_en?: string | null; atendido_por?: string | null; notas?: string | null },
) {
  const { error } = await db().from("leads").update(cambios).eq("id", id);
  if (error) throw error;
}

/* --------------------- Sincronización con el CRM ------------------------- */

export interface ResumenSincronizacion {
  /** true si faltan las credenciales de Airtable: no se intentó nada. */
  apagado: boolean;
  creados: number;
  vinculados: number;
  actualizados: number;
  /** Leads que todavía no dieron ni nombre ni empresa. */
  sinDatos: number;
  errores: number;
}

/**
 * Pasa por todos los leads y los lleva al maestro de clientes. Es la carga
 * inicial —los que ya existían antes de esta integración— y el reintento de
 * los que fallaron: el bot ya sincroniza solo en cada mensaje nuevo.
 *
 * Va de a uno a propósito: Airtable corta en 5 peticiones por segundo y por
 * base, y aquí no hay prisa.
 */
export async function sincronizarTodosConCrm(): Promise<ResumenSincronizacion> {
  const resumen: ResumenSincronizacion = {
    apagado: !configCrm(),
    creados: 0,
    vinculados: 0,
    actualizados: 0,
    sinDatos: 0,
    errores: 0,
  };
  if (resumen.apagado) return resumen;

  for (const lead of await todosLosLeads()) {
    if (!listoParaCrm(lead)) {
      resumen.sinDatos += 1;
      continue;
    }

    const { resultado, patch } = await sincronizarLead(lead);
    if (Object.keys(patch).length > 0) {
      const { error } = await db().from("leads").update(patch).eq("id", lead.id);
      if (error) console.error(`[crm] No se pudo guardar el enlace del lead ${lead.id}:`, error);
    }

    switch (resultado.estado) {
      case "creado":
        resumen.creados += 1;
        break;
      case "vinculado":
        resumen.vinculados += 1;
        break;
      case "actualizado":
        resumen.actualizados += 1;
        break;
      case "sin_datos":
        resumen.sinDatos += 1;
        break;
      default:
        resumen.errores += 1;
    }
  }

  return resumen;
}

/** El resumen en una frase, para el aviso del panel. */
export function resumenTexto(r: ResumenSincronizacion): string {
  if (r.apagado) {
    return "La conexión con el CRM no está configurada: faltan las variables de Airtable en el despliegue.";
  }
  const partes = [
    r.creados ? `${r.creados} cliente(s) nuevo(s)` : null,
    r.vinculados ? `${r.vinculados} enlazado(s) a un cliente que ya existía` : null,
    r.actualizados ? `${r.actualizados} ya estaban al día` : null,
    r.sinDatos ? `${r.sinDatos} sin datos todavía` : null,
    r.errores ? `${r.errores} con error` : null,
  ].filter(Boolean);
  return partes.length ? `Sincronización con el CRM: ${partes.join(", ")}.` : "No había nada que sincronizar.";
}

// --- Textos para mostrar ---

export function etapaTexto(etapa: string | null): string | null {
  return ETAPAS.find((e) => e.id === etapa)?.title ?? null;
}

export function hectareasTexto(hectareas: string | null): string | null {
  return HECTAREAS.find((h) => h.id === hectareas)?.title ?? null;
}

export function pasoTexto(lead: Lead): string {
  return NOMBRE_PASO[lead.paso] ? `Va en: ${NOMBRE_PASO[lead.paso]}` : lead.paso;
}

export function origenTexto(origen: string | null): string {
  return ORIGENES.find((o) => o.origen === origen)?.nombre ?? origen ?? "Escribió directo";
}

export function nombreDe(lead: Lead): string {
  return lead.nombre || lead.nombre_perfil || contactoTexto(lead);
}

function tieneTelefono(lead: Lead): boolean {
  return /^\d+$/.test(lead.wa_id);
}

/** Teléfono formateado, o el nombre de usuario de WhatsApp si Meta no envió el número. */
export function contactoTexto(lead: Lead): string {
  if (!tieneTelefono(lead)) return lead.username ? `@${lead.username} (sin número)` : "Sin número";
  // 573118882058 → +57 311 888 2058
  const m = lead.wa_id.match(/^57(\d{3})(\d{3})(\d{4})$/);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : `+${lead.wa_id}`;
}

export function telUrl(lead: Lead): string | null {
  return tieneTelefono(lead) ? `tel:+${lead.wa_id}` : null;
}

/** Enlace para abrir el chat con saludo escrito. null si no hay número (la persona usa nombre de usuario). */
export function whatsappUrl(lead: Lead, asesor: string): string | null {
  if (!tieneTelefono(lead)) return null;
  const saludo = lead.nombre ? `Hola, ${lead.nombre}` : "Hola";
  const texto = `${saludo}. Soy ${asesor}, de Sirius Regenerative. Te escribo por la información de biochar y biológicos que pediste.`;
  return `https://wa.me/${lead.wa_id}?text=${encodeURIComponent(texto)}`;
}

const formato = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function fechaTexto(iso: string | null): string {
  return iso ? formato.format(new Date(iso)) : "";
}
