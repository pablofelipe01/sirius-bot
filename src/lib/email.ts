import { FICHAS_NOMBRE_ARCHIVO } from "@/config/flujo";
import { env } from "./env";

/** true si hay llaves de Resend configuradas. */
export function emailConfigurado(): boolean {
  return Boolean(env.resendApiKey() && env.emailFrom());
}

/** Envía las fichas técnicas por correo con Resend. Devuelve false si no está configurado o falla. */
export async function enviarFichasPorCorreo(to: string, nombre: string | null, fichasUrl: string): Promise<boolean> {
  if (!emailConfigurado()) return false;
  const esPdf = new URL(fichasUrl).pathname.toLowerCase().endsWith(".pdf");
  const saludo = nombre ? `Hola, ${nombre}:` : "Hola:";
  const text = esPdf
    ? `${saludo}\n\nAdjuntamos las fichas técnicas de nuestros productos de biochar y biológicos.\n\nUn asesor te contacta esta semana.\n\nSirius Regenerative`
    : `${saludo}\n\nAquí están las fichas técnicas de nuestros productos de biochar y biológicos:\n${fichasUrl}\n\nUn asesor te contacta esta semana.\n\nSirius Regenerative`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.emailFrom(),
      to: [to],
      subject: "Fichas técnicas — Sirius Regenerative",
      text,
      ...(esPdf && { attachments: [{ path: fichasUrl, filename: FICHAS_NOMBRE_ARCHIVO }] }),
    }),
  });
  if (!res.ok) {
    console.error(`[email] Resend ${res.status}: ${await res.text()}`);
    return false;
  }
  return true;
}
