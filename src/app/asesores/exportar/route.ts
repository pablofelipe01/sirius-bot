import { leerSesion } from "@/lib/asesores-auth";
import {
  ESTADO_TEXTO,
  estadoDe,
  etapaTexto,
  fechaTexto,
  hectareasTexto,
  origenTexto,
  contactoTexto,
  todosLosLeads,
} from "@/lib/asesores-data";

/** Descarga todos los leads en CSV (separado por punto y coma, como lo abre Excel en español). */
export async function GET(request: Request) {
  if (!(await leerSesion())) {
    return Response.redirect(new URL("/asesores/login", request.url), 303);
  }

  const leads = await todosLosLeads();
  const columnas = [
    "Estado", "Nombre", "Nombre en WhatsApp", "Teléfono", "Empresa o finca", "Correo", "Etapa", "Hectáreas",
    "Municipio", "Departamento", "Origen", "Llegó", "Terminó cuestionario", "Fichas enviadas", "Motivo asesor",
    "Atendido", "Atendido por", "Notas",
  ];
  const filas = leads.map((l) => [
    ESTADO_TEXTO[estadoDe(l)], l.nombre, l.nombre_perfil, contactoTexto(l), l.empresa, l.correo ?? l.correo_sin_validar,
    etapaTexto(l.etapa), hectareasTexto(l.hectareas), l.municipio, l.departamento, origenTexto(l.origen),
    fechaTexto(l.created_at), fechaTexto(l.completado_en), fechaTexto(l.fichas_enviadas_en), l.motivo_asesor,
    fechaTexto(l.atendido_en), l.atendido_por, l.notas,
  ]);

  const celda = (valor: string | null | undefined) => {
    let texto = valor ?? "";
    // Evita que Excel lo interprete como fórmula (los teléfonos "+57 …" sí se dejan tal cual).
    if (/^[=@\t\r]|^[+-](?![\d ])/.test(texto)) texto = `'${texto}`;
    return `"${texto.replace(/"/g, '""')}"`;
  };
  const csv = "﻿" + [columnas, ...filas].map((fila) => fila.map(celda).join(";")).join("\r\n");
  const hoy = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-sirius-${hoy}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
