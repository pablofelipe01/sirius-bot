# Sirius — bot de atención al cliente por WhatsApp con IA

Next.js (App Router) + WhatsApp Cloud API + Claude (`claude-opus-5`).

## Cómo funciona

1. Meta envía cada mensaje a `POST /api/whatsapp`.
2. Se valida la firma `X-Hub-Signature-256` con el App Secret y se responde `200` al instante.
3. En segundo plano (`after()`): se marca como leído con el indicador "escribiendo…", se guarda el mensaje (ignorando los reintentos de Meta), se envía el historial a Claude y se responde por WhatsApp.

| Archivo | Qué contiene |
|---|---|
| `src/config/flujo.ts` | **Textos, botones y opciones del flujo guiado (QR).** |
| `src/lib/flow.ts` | Pasos del flujo guiado y validaciones |
| `src/lib/municipios.ts` + `src/data/municipios.ts` | Validación del municipio contra el listado del DANE |
| `src/lib/email.ts` | Envío opcional de las fichas por correo (Resend) |
| `src/app/privacidad/page.tsx` | Política de tratamiento de datos (Ley 1581) — borrador, revisar |
| `docs/qr-conferencia-palma-2026.png` | QR de la Conferencia de Palma 2026 |
| `src/config/bot.ts` | **Personalidad, info del negocio y preguntas frecuentes. Edita esto primero.** |
| `src/app/api/whatsapp/route.ts` | Webhook (verificación GET + mensajes POST) |
| `src/lib/whatsapp.ts` | Firma, envío de mensajes y parseo del payload |
| `src/lib/ai.ts` | Llamada a Claude (con caché del prompt y modelo de respaldo si hay rechazo) |
| `src/lib/store.ts` | Historial: Supabase, o memoria si no hay credenciales |
| `supabase/migrations/…_wa_mensajes.sql` | Tabla del historial |

## Flujo guiado (QR)

El QR abre WhatsApp con un mensaje prescrito; si el mensaje contiene la frase de `ORIGENES` (`src/config/flujo.ts`) se guarda el origen del lead.
Pasos: saludo → nombre → empresa → aviso de Habeas Data + correo → etapa → hectáreas → municipio (→ departamento) → fichas → cierre.
Cada respuesta se guarda en la tabla `leads` (una fila por número). Cuando termina, los mensajes libres los responde la IA.

- **Salida a asesor:** dos respuestas inesperadas seguidas, o si pide un asesor → `requiere_asesor = true` en `leads`.
- **Eliminar datos:** si el cliente escribe "borrar mis datos", se borran su lead y su historial. Útil también para volver a probar el flujo desde cero.
- **Volver a escanear el QR** reinicia el flujo desde el saludo.

Link del QR: `https://wa.me/573224183251?text=Hola%2C%20vengo%20de%20la%20Conferencia%20de%20Palma%202026%20y%20quiero%20informaci%C3%B3n%20sobre%20biochar%20y%20biol%C3%B3gicos.`

## Configuración

### 1. Variables de entorno
```bash
cp .env.example .env.local   # y llena los valores
```
`WHATSAPP_VERIFY_TOKEN` lo inventas tú (cualquier texto aleatorio largo).

### 2. Supabase (necesario en Vercel)
Crea un proyecto, ejecuta el SQL de `supabase/migrations/` (SQL Editor o `supabase db push`) y pon `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Sin estas variables el bot usa memoria, que en Vercel pierde el historial entre invocaciones.

### 3. Probar en local
```bash
pnpm dev
ngrok http 3000     # o cloudflared tunnel --url http://localhost:3000
```

### 4. Desplegar en Vercel
Importa el repo, agrega las mismas variables en *Settings → Environment Variables* y despliega.

### 5. Conectar el webhook en Meta
En developers.facebook.com → tu app → *WhatsApp → Configuración*:
- **URL de devolución de llamada:** `https://TU-DOMINIO/api/whatsapp`
- **Token de verificación:** el valor de `WHATSAPP_VERIFY_TOKEN`
- **Campos del webhook:** suscribe `messages`

Si el número no recibe eventos, suscribe la app a la WABA:
```bash
curl -X POST "https://graph.facebook.com/v23.0/$WHATSAPP_BUSINESS_ACCOUNT_ID/subscribed_apps" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN"
```

## Limitaciones actuales
- Solo texto: audios, imágenes y documentos reciben un mensaje pidiendo escribir.
- Si el cliente envía varios mensajes seguidos, cada uno recibe su propia respuesta.
- El traspaso a asesor solo marca el lead en Supabase (`requiere_asesor`); nadie recibe aviso automático todavía.
