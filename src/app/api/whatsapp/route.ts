import { after } from "next/server";
import { ERROR_REPLY, HISTORY_LIMIT, UNSUPPORTED_MESSAGE_REPLY } from "@/config/bot";
import { AVISO_ASESOR } from "@/config/flujo";
import { generateReply } from "@/lib/ai";
import { enviarFichasPorCorreo } from "@/lib/email";
import { env } from "@/lib/env";
import { procesarFlujo, type Canal, type Entrada } from "@/lib/flow";
import { getStore, type ConversationStore, type Lead } from "@/lib/store";
import {
  extractInboundMessages,
  isValidSignature,
  markReadWithTyping,
  sendButtons,
  sendDocument,
  sendList,
  sendTemplate,
  sendText,
  type IncomingMessage,
  type InboundEvent,
} from "@/lib/whatsapp";

// Tiempo máximo para que Claude responda dentro de after() (segundos).
export const maxDuration = 60;

/** Verificación del webhook que hace Meta al configurarlo. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === env.whatsappVerifyToken()
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Mensajes entrantes. Responde 200 de inmediato y procesa después, para que Meta no reintente. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!isValidSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let events: InboundEvent[];
  try {
    events = extractInboundMessages(JSON.parse(rawBody));
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (events.length > 0) {
    after(async () => {
      for (const event of events) {
        await handleMessage(event).catch((err) =>
          console.error(`[webhook] Error procesando ${event.message.id}:`, err),
        );
      }
    });
  }

  return new Response("OK", { status: 200 });
}

async function handleMessage({ message, contactName }: InboundEvent) {
  const store = getStore();
  const waId = message.from;

  await markReadWithTyping(message.id).catch((err) =>
    console.warn("[webhook] No se pudo marcar como leído:", err),
  );

  const entrada = toEntrada(message);
  const isNew = await store.saveIncoming(waId, message.id, describeEntrada(entrada, message.type));
  if (!isNew) return; // reintento de Meta: ya se respondió

  const handledByFlow = await procesarFlujo(await store.getLead(waId), waId, entrada, {
    canal: canalFor(store, waId),
    saveLead: (patch) => store.saveLead(waId, patch),
    deleteContact: () => store.deleteContact(waId),
    fichasUrl: env.fichasUrl(),
    politicaUrl: env.politicaDatosUrl(),
    enviarCorreo: enviarFichasPorCorreo,
    avisarAsesor,
    now: () => new Date().toISOString(),
    nombrePerfil: contactName,
  });
  if (handledByFlow) return;

  if (entrada.tipo === "otro") {
    await sendText(waId, UNSUPPORTED_MESSAGE_REPLY);
    return;
  }

  let reply: string | null;
  try {
    const history = await store.getHistory(waId, HISTORY_LIMIT);
    reply = await generateReply(history);
  } catch (err) {
    console.error("[webhook] Error de IA:", err);
    reply = null;
  }

  const finalReply = reply ?? ERROR_REPLY;
  await sendText(waId, finalReply);
  if (reply) await store.saveReply(waId, reply);
}

/** Manda al asesor la plantilla con los datos del cliente. Si falla, solo queda en el log (el lead ya está marcado). */
async function avisarAsesor(lead: Lead, motivo: string): Promise<void> {
  // Las variables de plantilla no pueden ir vacías ni tener saltos de línea.
  const limpio = (value: string | null | undefined, fallback: string) =>
    value?.replace(/\s+/g, " ").trim().slice(0, 200) || fallback;
  try {
    await sendTemplate(AVISO_ASESOR.whatsapp, AVISO_ASESOR.plantilla, AVISO_ASESOR.idioma, [
      limpio(lead.nombre ?? lead.nombre_perfil, "Sin nombre"),
      `https://wa.me/${lead.wa_id}`,
      limpio(lead.empresa, "No la dio"),
      limpio(motivo, "Necesita un asesor"),
    ]);
  } catch (err) {
    console.error(`[asesor] No se pudo avisar al asesor sobre ${lead.wa_id}:`, err);
  }
}

function toEntrada(message: IncomingMessage): Entrada {
  if (message.type === "text" && message.text?.body) return { tipo: "texto", texto: message.text.body };
  const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
  if (message.type === "interactive" && reply) return { tipo: "opcion", id: reply.id, titulo: reply.title };
  return { tipo: "otro" };
}

/** Cómo queda el mensaje entrante en el historial (lo que ve la IA después). */
function describeEntrada(entrada: Entrada, type: string): string {
  if (entrada.tipo === "texto") return entrada.texto;
  if (entrada.tipo === "opcion") return entrada.titulo;
  return `[mensaje tipo ${type}]`;
}

/** Envía por WhatsApp y guarda cada mensaje del bot en el historial. */
function canalFor(store: ConversationStore, waId: string): Canal {
  return {
    async text(body) {
      await sendText(waId, body);
      await store.saveReply(waId, body);
    },
    async buttons(body, buttons) {
      await sendButtons(waId, body, buttons);
      await store.saveReply(waId, `${body}\n[Opciones: ${buttons.map((b) => b.title).join(" | ")}]`);
    },
    async list(body, buttonText, rows) {
      await sendList(waId, body, buttonText, rows);
      await store.saveReply(waId, `${body}\n[Opciones: ${rows.map((r) => r.title).join(" | ")}]`);
    },
    async document(link, filename) {
      await sendDocument(waId, link, filename);
      await store.saveReply(waId, `[Documento enviado: ${filename}]`);
    },
  };
}
