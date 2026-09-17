import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// Límite de caracteres de un mensaje de texto en la Cloud API.
const MAX_TEXT_LENGTH = 4096;

/** Valida la cabecera X-Hub-Signature-256 que Meta firma con el App Secret. */
export function isValidSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.whatsappAppSecret()).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Envía a la Cloud API. Devuelve el id del mensaje creado (wamid…), si lo hay. */
async function graphPost(body: unknown): Promise<string | undefined> {
  const url = `https://graph.facebook.com/${env.whatsappApiVersion()}/${env.whatsappPhoneNumberId()}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsappToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json().catch(() => null)) as { messages?: { id: string }[] } | null;
  return data?.messages?.[0]?.id;
}

/** Marca el mensaje como leído (doble check azul) y muestra "escribiendo…". */
export async function markReadWithTyping(messageId: string): Promise<void> {
  await graphPost({
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type: "text" },
  });
}

/** Devuelve el id del último fragmento enviado. */
export async function sendText(to: string, text: string): Promise<string | undefined> {
  let id: string | undefined;
  for (const chunk of splitText(text)) {
    id = await graphPost({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: chunk },
    });
  }
  return id;
}

export interface Button {
  id: string;
  title: string; // máx. 20 caracteres
}

/** Mensaje con hasta 3 botones de respuesta rápida. */
export async function sendButtons(to: string, body: string, buttons: Button[]): Promise<string | undefined> {
  return graphPost({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: buttons.map((reply) => ({ type: "reply", reply })) },
    },
  });
}

export interface ListRow {
  id: string;
  title: string; // máx. 24 caracteres
  description?: string; // máx. 72 caracteres
}

/** Lista desplegable (hasta 10 opciones). `buttonText` es el texto del botón que la abre (máx. 20). */
export async function sendList(to: string, body: string, buttonText: string, rows: ListRow[]): Promise<string | undefined> {
  return graphPost({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: { button: buttonText, sections: [{ title: "Opciones", rows }] },
    },
  });
}

/** Documento por URL pública (WhatsApp lo descarga; máx. 100 MB). */
export async function sendDocument(to: string, link: string, filename: string): Promise<string | undefined> {
  return graphPost({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: { link, filename },
  });
}

/** Plantilla aprobada por Meta, con variables de texto en el cuerpo ({{1}}, {{2}}…). */
export async function sendTemplate(to: string, name: string, language: string, params: string[]): Promise<string | undefined> {
  return graphPost({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
    },
  });
}

/** Parte textos largos por párrafos/líneas para no pasar el límite de WhatsApp. */
function splitText(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > MAX_TEXT_LENGTH) {
    const window = rest.slice(0, MAX_TEXT_LENGTH);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
    const at = cut > MAX_TEXT_LENGTH / 2 ? cut + 1 : MAX_TEXT_LENGTH;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// --- Tipos mínimos del payload de webhook ---

export interface IncomingMessage {
  id: string;
  from: string; // wa_id del cliente (número sin +)
  type: string;
  timestamp: string;
  text?: { body: string };
  interactive?: {
    type: "button_reply" | "list_reply";
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

interface WebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: IncomingMessage[];
        statuses?: DeliveryStatus[];
      };
    }[];
  }[];
}

/** Estado de entrega de un mensaje enviado por el bot. */
export interface DeliveryStatus {
  id: string; // wamid del mensaje enviado
  status: "sent" | "delivered" | "read" | "failed" | string;
  timestamp: string; // segundos Unix
  recipient_id: string;
  errors?: { code: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

/** Extrae los estados de entrega (sent/delivered/read/failed) de nuestro número. */
export function extractStatuses(payload: WebhookPayload): DeliveryStatus[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const ourPhoneId = env.whatsappPhoneNumberId();
  return (payload.entry ?? []).flatMap((entry) =>
    (entry.changes ?? []).flatMap((change) =>
      change.field === "messages" && change.value?.metadata?.phone_number_id === ourPhoneId
        ? (change.value.statuses ?? [])
        : [],
    ),
  );
}

export interface InboundEvent {
  message: IncomingMessage;
  contactName?: string;
}

/** Extrae los mensajes entrantes dirigidos a nuestro número (ignora estados de entrega). */
export function extractInboundMessages(payload: WebhookPayload): InboundEvent[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const ourPhoneId = env.whatsappPhoneNumberId();
  const events: InboundEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (change.field !== "messages" || !value?.messages) continue;
      if (value.metadata?.phone_number_id !== ourPhoneId) continue;
      for (const message of value.messages) {
        // Normalmente `from` trae el número; si no viene, se toma del contacto del mismo webhook.
        const from = message.from || (value.contacts?.length === 1 ? value.contacts[0].wa_id : undefined);
        if (!from) {
          console.error("[webhook] Mensaje sin número de remitente:", JSON.stringify(message));
          continue;
        }
        const contact = value.contacts?.find((c) => c.wa_id === from);
        events.push({ message: { ...message, from }, contactName: contact?.profile?.name });
      }
    }
  }
  return events;
}
