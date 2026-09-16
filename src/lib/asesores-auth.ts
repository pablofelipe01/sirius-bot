import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";

// Sesión del panel de asesores: cookie firmada con HMAC (sin base de datos).
// La llave sale de la contraseña, así que cambiar ASESORES_PASSWORD cierra todas las sesiones.

const COOKIE = "asesor_sesion";
const DURACION_SEGUNDOS = 30 * 24 * 60 * 60; // 30 días

export interface SesionAsesor {
  nombre: string;
}

function llave(): Buffer | null {
  const password = env.asesoresPassword();
  if (!password) return null;
  return createHash("sha256").update(`sirius-asesores:${password}`).digest();
}

function firmar(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function iguales(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/** Valida la contraseña y deja la sesión abierta. Devuelve false si la contraseña no coincide. */
export async function iniciarSesion(nombre: string, password: string): Promise<boolean> {
  const esperada = env.asesoresPassword();
  const key = llave();
  if (!esperada || !key || !iguales(password, esperada)) return false;

  const exp = Math.floor(Date.now() / 1000) + DURACION_SEGUNDOS;
  const payload = Buffer.from(JSON.stringify({ nombre, exp })).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${firmar(payload, key)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/asesores",
    maxAge: DURACION_SEGUNDOS,
  });
  return true;
}

export async function cerrarSesion(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/asesores" });
}

export async function leerSesion(): Promise<SesionAsesor | null> {
  const key = llave();
  const valor = (await cookies()).get(COOKIE)?.value;
  if (!key || !valor) return null;
  const [payload, firma] = valor.split(".");
  if (!payload || !firma || !iguales(firma, firmar(payload, key))) return null;
  try {
    const { nombre, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { nombre: string; exp: number };
    if (typeof nombre !== "string" || exp < Date.now() / 1000) return null;
    return { nombre };
  } catch {
    return null;
  }
}

/** Para páginas, acciones y rutas del panel: sin sesión válida, manda al login. */
export async function requerirAsesor(): Promise<SesionAsesor> {
  const sesion = await leerSesion();
  if (!sesion) redirect("/asesores/login");
  return sesion;
}
