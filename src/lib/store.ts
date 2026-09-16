import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

export type Role = "user" | "assistant";

export interface StoredMessage {
  role: Role;
  content: string;
}

/** Fila de la tabla `leads` (mismos nombres de columna). */
export interface Lead {
  wa_id: string;
  nombre_perfil: string | null;
  origen: string | null;
  paso: string;
  intentos_fallidos: number;
  nombre: string | null;
  empresa: string | null;
  correo: string | null;
  correo_sin_validar: string | null;
  autoriza_datos_en: string | null;
  etapa: string | null;
  hectareas: string | null;
  municipio: string | null;
  departamento: string | null;
  municipio_encontrado: boolean | null;
  fichas_enviadas_en: string | null;
  correo_enviado_en: string | null;
  requiere_asesor: boolean;
  motivo_asesor: string | null;
  completado_en: string | null;
}

export type LeadPatch = Partial<Omit<Lead, "wa_id">>;

export function emptyLead(waId: string): Lead {
  return {
    wa_id: waId,
    nombre_perfil: null,
    origen: null,
    paso: "inicio",
    intentos_fallidos: 0,
    nombre: null,
    empresa: null,
    correo: null,
    correo_sin_validar: null,
    autoriza_datos_en: null,
    etapa: null,
    hectareas: null,
    municipio: null,
    departamento: null,
    municipio_encontrado: null,
    fichas_enviadas_en: null,
    correo_enviado_en: null,
    requiere_asesor: false,
    motivo_asesor: null,
    completado_en: null,
  };
}

export interface ConversationStore {
  /** Guarda el mensaje entrante. Devuelve false si ya se había procesado (reintento de Meta). */
  saveIncoming(waId: string, waMessageId: string, content: string): Promise<boolean>;
  saveReply(waId: string, content: string): Promise<void>;
  /** Últimos `limit` mensajes en orden cronológico. */
  getHistory(waId: string, limit: number): Promise<StoredMessage[]>;
  getLead(waId: string): Promise<Lead | null>;
  /** Crea o actualiza el lead del número. */
  saveLead(waId: string, patch: LeadPatch): Promise<void>;
  /** Borra el lead y todo el historial del número (solicitud de eliminación de datos). */
  deleteContact(waId: string): Promise<void>;
}

// --- Supabase (producción) ---

class SupabaseStore implements ConversationStore {
  constructor(private db: SupabaseClient) {}

  async saveIncoming(waId: string, waMessageId: string, content: string) {
    const { error } = await this.db
      .from("wa_mensajes")
      .insert({ wa_id: waId, wa_message_id: waMessageId, rol: "user", contenido: content });
    if (error?.code === "23505") return false; // unique_violation → duplicado
    if (error) throw error;
    return true;
  }

  async saveReply(waId: string, content: string) {
    const { error } = await this.db
      .from("wa_mensajes")
      .insert({ wa_id: waId, rol: "assistant", contenido: content });
    if (error) throw error;
  }

  async getHistory(waId: string, limit: number) {
    const { data, error } = await this.db
      .from("wa_mensajes")
      .select("rol, contenido")
      .eq("wa_id", waId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data.reverse().map((row) => ({ role: row.rol as Role, content: row.contenido as string }));
  }

  async getLead(waId: string) {
    const { data, error } = await this.db.from("leads").select("*").eq("wa_id", waId).maybeSingle();
    if (error) throw error;
    return data as Lead | null;
  }

  async saveLead(waId: string, patch: LeadPatch) {
    const { error } = await this.db.from("leads").upsert({ ...patch, wa_id: waId }, { onConflict: "wa_id" });
    if (error) throw error;
  }

  async deleteContact(waId: string) {
    const leads = await this.db.from("leads").delete().eq("wa_id", waId);
    if (leads.error) throw leads.error;
    const mensajes = await this.db.from("wa_mensajes").delete().eq("wa_id", waId);
    if (mensajes.error) throw mensajes.error;
  }
}

// --- Memoria (solo desarrollo local: se pierde al reiniciar y no sirve en Vercel) ---

class MemoryStore implements ConversationStore {
  private messages = new Map<string, StoredMessage[]>();
  private seen = new Set<string>();
  private leads = new Map<string, Lead>();

  async saveIncoming(waId: string, waMessageId: string, content: string) {
    if (this.seen.has(waMessageId)) return false;
    this.seen.add(waMessageId);
    this.push(waId, { role: "user", content });
    return true;
  }

  async saveReply(waId: string, content: string) {
    this.push(waId, { role: "assistant", content });
  }

  async getHistory(waId: string, limit: number) {
    return (this.messages.get(waId) ?? []).slice(-limit);
  }

  async getLead(waId: string) {
    return this.leads.get(waId) ?? null;
  }

  async saveLead(waId: string, patch: LeadPatch) {
    this.leads.set(waId, { ...(this.leads.get(waId) ?? emptyLead(waId)), ...patch });
  }

  async deleteContact(waId: string) {
    this.leads.delete(waId);
    this.messages.delete(waId);
  }

  private push(waId: string, message: StoredMessage) {
    const list = this.messages.get(waId) ?? [];
    list.push(message);
    this.messages.set(waId, list);
  }
}

let store: ConversationStore | undefined;

export function getStore(): ConversationStore {
  if (store) return store;
  const url = env.supabaseUrl();
  const key = env.supabaseServiceRoleKey();
  if (url && key) {
    store = new SupabaseStore(createClient(url, key, { auth: { persistSession: false } }));
  } else {
    console.warn("[store] Sin SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: usando memoria (solo para desarrollo).");
    store = new MemoryStore();
  }
  return store;
}
