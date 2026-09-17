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

/**
 * Campo de destinatario según el identificador: número (solo dígitos) → `to`;
 * business-scoped user ID ("CO.1060…", cuando la persona usa nombre de usuario y no hay número) → `recipient`.
 */
function destino(id: string): { to: string } | { recipient: string } {
  return /^\d+$/.test(id) ? { to: id } : { recipient: id };
}

/** true si el identificador es un número de teléfono (y no un BSUID). */
export function esTelefono(id: string): boolean {
  return /^\d+$/.test(id);
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
      ...destino(to),
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
    ...destino(to),
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
    ...destino(to),
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
    ...destino(to),
    type: "document",
    document: { link, filename },
  });
}

/** Plantilla aprobada por Meta, con variables de texto en el cuerpo ({{1}}, {{2}}…). */
export async function sendTemplate(to: string, name: string, language: string, params: string[]): Promise<string | undefined> {
  return graphPost({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...destino(to),
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
  from?: string; // número del cliente (sin +); Meta lo omite si la persona usa nombre de usuario
  from_user_id?: string; // business-scoped user ID (BSUID), siempre presente
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
        contacts?: { wa_id?: string; user_id?: string; profile?: { name?: string; username?: string } }[];
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
  recipient_id?: string; // número; se omite si se envió a un BSUID sin número conocido
  recipient_user_id?: string; // BSUID
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
  phone?: string; // número, si Meta lo envía
  userId?: string; // BSUID
  contactName?: string;
  username?: string;
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
        const contacts = value.contacts ?? [];
        const contact =
          contacts.find((c) => (message.from_user_id && c.user_id === message.from_user_id) || (message.from && c.wa_id === message.from)) ??
          (contacts.length === 1 ? contacts[0] : undefined);
        const phone = message.from || contact?.wa_id;
        const userId = message.from_user_id || contact?.user_id;
        if (!phone && !userId) {
          console.error("[webhook] Mensaje sin número ni BSUID:", JSON.stringify(message));
          continue;
        }
        events.push({ message, phone, userId, contactName: contact?.profile?.name, username: contact?.profile?.username });
      }
    }
  }
  return events;
}
