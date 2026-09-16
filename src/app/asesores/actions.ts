"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cerrarSesion, iniciarSesion, requerirAsesor } from "@/lib/asesores-auth";
import { actualizarSeguimiento } from "@/lib/asesores-data";

export interface EstadoLogin {
  error?: string;
}

export async function entrar(_prev: EstadoLogin | undefined, formData: FormData): Promise<EstadoLogin> {
  const nombre = String(formData.get("nombre") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!nombre || nombre.length > 40) return { error: "Escribe tu nombre (máximo 40 caracteres)." };
  if (!(await iniciarSesion(nombre, password))) {
    // Pausa corta para frenar intentos repetidos de adivinar la contraseña.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { error: "La contraseña no es correcta." };
  }
  redirect("/asesores");
}

export async function salir() {
  await cerrarSesion();
  redirect("/asesores/login");
}

function idDe(formData: FormData): string {
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("id inválido");
  return id;
}

export async function marcarAtendido(formData: FormData) {
  const { nombre } = await requerirAsesor();
  await actualizarSeguimiento(idDe(formData), { atendido_en: new Date().toISOString(), atendido_por: nombre });
  revalidatePath("/asesores", "layout");
}

export async function reabrir(formData: FormData) {
  await requerirAsesor();
  await actualizarSeguimiento(idDe(formData), { atendido_en: null, atendido_por: null });
  revalidatePath("/asesores", "layout");
}

export async function guardarNotas(formData: FormData) {
  await requerirAsesor();
  const notas = String(formData.get("notas") ?? "").trim().slice(0, 5000);
  await actualizarSeguimiento(idDe(formData), { notas: notas || null });
  revalidatePath("/asesores", "layout");
}
