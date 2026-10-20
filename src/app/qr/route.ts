import { QR } from "@/config/flujo";

/** Destino del QR permanente: abre WhatsApp con el mensaje del evento actual. */
export function GET() {
  // 302 (temporal) para que el celular no se quede con el destino viejo cuando cambie el mensaje.
  return Response.redirect(`https://wa.me/${QR.whatsapp}?text=${encodeURIComponent(QR.mensaje)}`, 302);
}
