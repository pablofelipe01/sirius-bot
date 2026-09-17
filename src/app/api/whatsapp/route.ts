import { after } from "next/server";
import { ERROR_REPLY, HISTORY_LIMIT, UNSUPPORTED_MESSAGE_REPLY } from "@/config/bot";
import { AVISO_ASESOR } from "@/config/flujo";
import { generateReply } from "@/lib/ai";
import { enviarFichasPorCorreo } from "@/lib/email";
import { env } from "@/lib/env";
import { procesarFlujo, type Canal, type Entrada } from "@/lib/flow";
import { getStore, getSupabaseAdmin, type ConversationStore, type Lead } from "@/lib/store";
import {
  extractInboundMessages,
  extractStatuses,
  isValidSignature,
  markReadWithTyping,
  sendButtons,
  sendDocument,
  sendList,
  sendTemplate,
  sendText,
  type DeliveryStatus,
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
  let statuses: DeliveryStatus[];
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
    events = extractInboundMessages(payload as Parameters<typeof extractInboundMessages>[0]);
    statuses = extractStatuses(payload as Parameters<typeof extractStatuses>[0]);
  } catch (err) {
    after(() => logWebhook(payload ?? { raw: rawBody }, `No se pudo leer: ${String(err)}`));
    return new Response("Bad request", { status: 400 });
  }

  if (statuses.length === 0 || events.length > 0) {
    // Los mensajes entrantes (y cualquier aviso raro) se guardan crudos para diagnóstico.
    after(() => logWebhook(payload));
  }
  if (events.length === 0 && statuses.length === 0) {
    console.warn("[webhook] Webhook sin mensajes ni estados:", rawBody.slice(0, 2000));
  }

  if (statuses.length > 0) {
    after(() => saveStatuses(statuses));
  }

  if (events.length > 0) {
    after(async () => {
      for (const event of events) {
        await handleMessage(event).catch(async (err) => {
          console.error(`[webhook] Error procesando ${event.message.id}:`, err);
          await logWebhook({ message: event.message, contactName: event.contactName }, errorText(err));
        });
      }
    });
  }

  return new Response("OK", { status: 200 });
}

async function handleMessage({ message, contactName }: InboundEvent) {
  const store = getStore();
  const waId = message.from;
  console.log(`[webhook] Mensaje ${message.type} de ${waId}`);

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
  const replyId = await sendText(waId, finalReply);
  if (reply) await store.saveReply(waId, reply, replyId);
}

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.message}\n${err.stack ?? ""}`.slice(0, 4000);
  return JSON.stringify(err).slice(0, 4000);
}

/** Guarda el webhook crudo (y el error, si lo hubo). Nunca lanza. */
async function logWebhook(payload: unknown, error?: string) {
  const db = getSupabaseAdmin();
  if (!db) return;
  const { error: dbError } = await db.from("wa_webhooks").insert({ payload, error: error ?? null });
  if (dbError) console.error("[webhook] No se pudo guardar el webhook crudo:", dbError);
}

/** Guarda los estados de entrega. Los fallos también quedan en el log de Vercel con el código de error de Meta. */
async function saveStatuses(statuses: DeliveryStatus[]) {
  for (const s of statuses) {
    if (s.status === "failed") {
      console.error(`[entrega] Falló el mensaje ${s.id} a ${s.recipient_id}:`, JSON.stringify(s.errors));
    }
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  const { error } = await db.from("wa_estados").insert(
    statuses.map((s) => ({
      wa_message_id: s.id,
      wa_id: s.recipient_id,
      estado: s.status,
      error_codigo: s.errors?.[0]?.code ?? null,
      error_titulo: s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? null,
      error_detalle: s.errors?.[0]?.error_data?.details ?? null,
      ocurrido_en: new Date(Number(s.timestamp) * 1000).toISOString(),
    })),
  );
  if (error) console.error("[entrega] No se pudieron guardar los estados:", error);
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
      const id = await sendText(waId, body);
      await store.saveReply(waId, body, id);
    },
    async buttons(body, buttons) {
      const id = await sendButtons(waId, body, buttons);
      await store.saveReply(waId, `${body}\n[Opciones: ${buttons.map((b) => b.title).join(" | ")}]`, id);
    },
    async list(body, buttonText, rows) {
      const id = await sendList(waId, body, buttonText, rows);
      await store.saveReply(waId, `${body}\n[Opciones: ${rows.map((r) => r.title).join(" | ")}]`, id);
    },
    async document(link, filename) {
      const id = await sendDocument(waId, link, filename);
      await store.saveReply(waId, `[Documento enviado: ${filename}]`, id);
    },
  };
}
