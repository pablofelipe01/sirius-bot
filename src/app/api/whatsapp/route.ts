import { after } from "next/server";
import { ERROR_REPLY, HISTORY_LIMIT, UNSUPPORTED_MESSAGE_REPLY } from "@/config/bot";
import { generateReply } from "@/lib/ai";
import { env } from "@/lib/env";
import { getStore } from "@/lib/store";
import {
  extractInboundMessages,
  isValidSignature,
  markReadWithTyping,
  sendText,
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

async function handleMessage({ message }: InboundEvent) {
  const store = getStore();
  const waId = message.from;

  await markReadWithTyping(message.id).catch((err) =>
    console.warn("[webhook] No se pudo marcar como leído:", err),
  );

  if (message.type !== "text" || !message.text?.body) {
    const isNew = await store.saveIncoming(waId, message.id, `[mensaje tipo ${message.type}]`);
    if (isNew) await sendText(waId, UNSUPPORTED_MESSAGE_REPLY);
    return;
  }

  const isNew = await store.saveIncoming(waId, message.id, message.text.body);
  if (!isNew) return; // reintento de Meta: ya se respondió

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
