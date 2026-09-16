function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  whatsappToken: () => required("WHATSAPP_ACCESS_TOKEN"),
  whatsappPhoneNumberId: () => required("WHATSAPP_PHONE_NUMBER_ID"),
  whatsappAppSecret: () => required("WHATSAPP_APP_SECRET"),
  whatsappVerifyToken: () => required("WHATSAPP_VERIFY_TOKEN"),
  whatsappApiVersion: () => process.env.WHATSAPP_API_VERSION || "v23.0",
  supabaseUrl: () => process.env.SUPABASE_URL,
  supabaseServiceRoleKey: () => process.env.SUPABASE_SERVICE_ROLE_KEY,
  /** URL pública del PDF con las fichas técnicas (o de una carpeta de Drive si pesa más de 100 MB). */
  fichasUrl: () => process.env.FICHAS_URL,
  /** Página de la política de tratamiento de datos. Por defecto, /privacidad de este mismo sitio. */
  politicaDatosUrl: () => process.env.POLITICA_DATOS_URL || `${siteUrl()}/privacidad`,
  /** Envío de las fichas por correo con Resend. Si falta alguna, no se envía correo. */
  resendApiKey: () => process.env.RESEND_API_KEY,
  emailFrom: () => process.env.EMAIL_FROM,
};

function siteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  // Variable de sistema de Vercel con el dominio de producción.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}
