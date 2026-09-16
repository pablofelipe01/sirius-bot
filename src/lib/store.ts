import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

export type Role = "user" | "assistant";

export interface StoredMessage {
  role: Role;
  content: string;
}

export interface ConversationStore {
  /** Guarda el mensaje entrante. Devuelve false si ya se había procesado (reintento de Meta). */
  saveIncoming(waId: string, waMessageId: string, content: string): Promise<boolean>;
  saveReply(waId: string, content: string): Promise<void>;
  /** Últimos `limit` mensajes en orden cronológico. */
  getHistory(waId: string, limit: number): Promise<StoredMessage[]>;
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
}

// --- Memoria (solo desarrollo local: se pierde al reiniciar y no sirve en Vercel) ---

class MemoryStore implements ConversationStore {
  private messages = new Map<string, StoredMessage[]>();
  private seen = new Set<string>();

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
