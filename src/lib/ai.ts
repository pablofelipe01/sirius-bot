import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/config/bot";
import type { StoredMessage } from "./store";

const client = new Anthropic(); // lee ANTHROPIC_API_KEY

const MODEL = "claude-opus-5";

/**
 * Genera la respuesta del bot a partir del historial (que ya incluye el
 * último mensaje del cliente). Devuelve null si Claude no produjo texto.
 */
export async function generateReply(history: StoredMessage[]): Promise<string | null> {
  // La API exige que la conversación empiece con un mensaje del usuario.
  const firstUser = history.findIndex((m) => m.role === "user");
  const messages: Anthropic.Beta.BetaMessageParam[] = history
    .slice(firstUser === -1 ? history.length : firstUser)
    .map((m) => ({ role: m.role, content: m.content }));
  if (messages.length === 0) return null;

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4096,
    // Chat de atención al cliente: esfuerzo medio mantiene la latencia baja.
    output_config: { effort: "medium" },
    // Si los filtros de seguridad rechazan la petición, la API reintenta con el modelo de respaldo recomendado.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Cachea el prompt de sistema + base de conocimiento entre mensajes.
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    cache_control: { type: "ephemeral" },
    messages,
  });

  if (response.stop_reason === "refusal") {
    console.warn("[ai] Respuesta rechazada:", response.stop_details);
    return null;
  }

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  console.log("[ai] uso", {
    input: response.usage.input_tokens,
    cache_read: response.usage.cache_read_input_tokens,
    output: response.usage.output_tokens,
    stop: response.stop_reason,
  });

  return text || null;
}
