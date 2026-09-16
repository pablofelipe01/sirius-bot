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
};
