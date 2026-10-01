import { ETAPAS, HECTAREAS } from "@/config/flujo";
import {
  actualizarRegistro,
  crearRegistro,
  listarRegistros,
  obtenerRegistro,
  texto,
  type AirtableRecord,
} from "./airtable";
import { env } from "./env";
import type { Lead } from "./store";

/**
 * Lleva los leads del bot a "Sirius Clients Core" (Airtable), el maestro de
 * clientes que lee el CRM.
 *
 * Tres reglas que explican casi todo el archivo:
 *
 * 1. El bot no depende de esto. Si faltan las credenciales o Airtable falla,
 *    `sincronizarLead` devuelve el error en vez de lanzarlo y la conversación
 *    de WhatsApp sigue igual.
 * 2. No se escribe encima de lo que escribió una persona. Al crear la ficha se
 *    llena todo; al volver a sincronizar solo se rellenan las celdas que siguen
 *    vacías. El nombre del cliente no se cambia nunca.
 * 3. No se duplican clientes. Si ya existe uno con el mismo nombre —lo creó un
 *    asesor desde el CRM, o este mismo lead en otra conversación— el lead se
 *    cuelga de esa ficha en lugar de abrir otra.
 */

/** Campos de la tabla Clientes, tal como se llaman en Airtable. */
const CLIENTE = {
  id: "ID",
  nombre: "Cliente",
  ciudad: "Ciudad",
  departamento: "Departamento",
  estado: "Estado Cliente",
  sector: "Sector o cultivo",
  segmento: "Segmento (potencial)",
  etapa: "Etapa comercial",
  observaciones: "Observaciones",
  comoConocio: "Como Conocio Sirius",
  creadoPor: "Creado Por ID",
  modificadoPor: "Modificado Por ID",
} as const;

/** Campos de la tabla Personal Cliente (las personas de contacto). */
const CONTACTO = {
  nombre: "Nombre Completo",
  email: "Email",
  telefono: "Teléfono",
  cliente: "Cliente",
  estado: "Estado Personal",
  creadoPor: "Creado Por ID",
  modificadoPor: "Modificado Por ID",
} as const;

/** Cultivo que se asume según el QR por el que llegó la persona. */
const SECTOR_POR_ORIGEN: Record<string, string> = {
  conferencia_palma_2026: "Palma",
};

/** Canal del maestro de clientes ("Como Conocio Sirius") según el origen del lead. */
function canalDe(lead: Lead): string {
  return lead.origen ? "Feria o evento" : "WhatsApp";
}

export interface ConfigCrm {
  apiKey: string;
  baseClientes: string;
  tablaClientes: string;
  tablaPersonalCliente: string;
  /** ID Empleado con el que firma el bot ("SIRIUS-PER-XXXX"); vacío si no se configuró. */
  autorId: string;
}

/** La configuración del CRM, o null si falta algo: entonces la sincronización está apagada. */
export function configCrm(): ConfigCrm | null {
  const apiKey = env.airtableApiKey();
  const baseClientes = env.crmBaseClientes();
  const tablaClientes = env.crmTablaClientes();
  const tablaPersonalCliente = env.crmTablaPersonalCliente();
  if (!apiKey || !baseClientes || !tablaClientes || !tablaPersonalCliente) return null;
  return { apiKey, baseClientes, tablaClientes, tablaPersonalCliente, autorId: env.crmAutorId() ?? "" };
}

export type Resultado =
  /** Faltan credenciales: la integración está apagada. */
  | { estado: "apagado" }
  /** La persona todavía no ha dado ni nombre ni empresa: no hay con qué abrir una ficha. */
  | { estado: "sin_datos" }
  | { estado: "creado" | "vinculado" | "actualizado"; recordId: string; clienteId: string | null }
  | { estado: "error"; mensaje: string };

/** Cambios que hay que guardar en la fila del lead después de sincronizar. */
export interface PatchCrm {
  crm_cliente_record_id?: string | null;
  crm_cliente_id?: string | null;
  crm_contacto_record_id?: string | null;
  crm_sincronizado_en?: string | null;
  crm_error?: string | null;
}

/* ----------------------------- Qué se sincroniza ------------------------- */

/**
 * Un lead llega al maestro de clientes cuando ya dijo quién es: nombre de la
 * persona o de la empresa. Los números que escanearon el QR y nunca
 * contestaron se quedan en el bot — una ficha sin nombre en Clients Core no se
 * puede trabajar, y allá un cliente no se borra, solo se inactiva.
 */
export function listoParaCrm(lead: Lead): boolean {
  return Boolean(nombreCliente(lead));
}

/** Con qué nombre se abre la ficha: la empresa o finca, y si no la dio, la persona. */
function nombreCliente(lead: Lead): string | null {
  return limpio(lead.empresa) ?? limpio(lead.nombre);
}

function limpio(valor: string | null | undefined): string | null {
  const texto = valor?.replace(/\s+/g, " ").trim();
  return texto ? texto : null;
}

function esTelefono(waId: string): boolean {
  return /^\d+$/.test(waId);
}

/** El número con el que escribió, o null si Meta solo mandó el nombre de usuario. */
function telefonoDe(lead: Lead): string | null {
  return esTelefono(lead.wa_id) ? `+${lead.wa_id}` : null;
}

function normalizarNombre(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Resumen de la conversación para el campo Observaciones. */
function observacionesDe(lead: Lead): string {
  const etapa = ETAPAS.find((e) => e.id === lead.etapa)?.title;
  const hectareas = HECTAREAS.find((h) => h.id === lead.hectareas)?.title;

  return [
    "Lead capturado por el bot de WhatsApp de Sirius.",
    lead.origen === "conferencia_palma_2026" ? "Origen: Conferencia de Palma 2026." : "Origen: escribió por WhatsApp.",
    lead.nombre ? `Habló con: ${lead.nombre}.` : null,
    etapa ? `Le interesa: ${etapa}.` : null,
    hectareas ? `Área que maneja: ${hectareas}.` : null,
    lead.municipio && lead.municipio_encontrado === false
      ? `Municipio como lo escribió (no coincidió con el listado del DANE): ${lead.municipio}.`
      : null,
    lead.correo_sin_validar && !lead.correo ? `Correo sin confirmar: ${lead.correo_sin_validar}.` : null,
    lead.requiere_asesor ? `Pidió asesor: ${lead.motivo_asesor ?? "sin motivo registrado"}.` : null,
    lead.completado_en
      ? `Terminó el cuestionario el ${lead.completado_en.slice(0, 10)}.`
      : "No terminó el cuestionario.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** La ficha completa, como se escribe al crear el cliente. */
function camposCliente(lead: Lead, nombre: string, autorId: string): Record<string, unknown> {
  return {
    [CLIENTE.nombre]: nombre,
    [CLIENTE.ciudad]: limpio(lead.municipio) ?? "",
    [CLIENTE.departamento]: limpio(lead.departamento) ?? "",
    [CLIENTE.sector]: (lead.origen && SECTOR_POR_ORIGEN[lead.origen]) || "",
    [CLIENTE.segmento]: HECTAREAS.find((h) => h.id === lead.hectareas)?.title ?? "",
    [CLIENTE.etapa]: "Prospecto",
    [CLIENTE.observaciones]: observacionesDe(lead),
    [CLIENTE.comoConocio]: canalDe(lead),
    [CLIENTE.creadoPor]: autorId,
    [CLIENTE.modificadoPor]: autorId,
  };
}

/**
 * De los campos de la ficha, los que se vuelven a mandar en una
 * resincronización: solo los que en Airtable siguen vacíos. Si un asesor
 * corrigió la ciudad o escribió en Observaciones, su texto manda.
 */
function soloLoQueFalta(
  deseados: Record<string, unknown>,
  registro: AirtableRecord,
  autorId: string,
): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};

  for (const [campo, valor] of Object.entries(deseados)) {
    // El nombre no se toca: es con lo que las visitas y los pedidos identifican
    // al cliente. La autoría tampoco, se resuelve al final.
    if (campo === CLIENTE.nombre || campo === CLIENTE.creadoPor || campo === CLIENTE.modificadoPor) continue;
    if (valor === "" || valor === null || valor === undefined) continue;
    if (texto(registro.fields[campo])) continue;
    cambios[campo] = valor;
  }

  if (Object.keys(cambios).length > 0 && autorId) cambios[CLIENTE.modificadoPor] = autorId;
  return cambios;
}

/* ------------------------------ Sincronización --------------------------- */

/**
 * Crea o actualiza la ficha del lead en Clients Core y devuelve qué guardar en
 * la fila del lead. Nunca lanza: los fallos vuelven como `{ estado: "error" }`.
 */
export async function sincronizarLead(lead: Lead): Promise<{ resultado: Resultado; patch: PatchCrm }> {
  const config = configCrm();
  if (!config) return { resultado: { estado: "apagado" }, patch: {} };

  const nombre = nombreCliente(lead);
  if (!nombre) return { resultado: { estado: "sin_datos" }, patch: {} };

  try {
    const { registro, estado } = await fichaDe(lead, nombre, config);
    const clienteId = texto(registro.fields[CLIENTE.id]);
    const contactoId = await sincronizarContacto(lead, registro.id, config);

    return {
      resultado: { estado, recordId: registro.id, clienteId },
      patch: {
        crm_cliente_record_id: registro.id,
        crm_cliente_id: clienteId,
        crm_contacto_record_id: contactoId,
        crm_sincronizado_en: new Date().toISOString(),
        crm_error: null,
      },
    };
  } catch (err) {
    const mensaje = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error(`[crm] No se pudo sincronizar ${lead.wa_id}:`, err);
    return { resultado: { estado: "error", mensaje }, patch: { crm_error: mensaje } };
  }
}

/** La ficha del cliente: la que ya tenía el lead, una homónima que ya existía, o una nueva. */
async function fichaDe(
  lead: Lead,
  nombre: string,
  config: ConfigCrm,
): Promise<{ registro: AirtableRecord; estado: "creado" | "vinculado" | "actualizado" }> {
  const deseados = camposCliente(lead, nombre, config.autorId);

  // a) Ya está enlazado: se completa lo que siga vacío.
  if (lead.crm_cliente_record_id) {
    const actual = await obtenerRegistro(
      config.apiKey,
      config.baseClientes,
      config.tablaClientes,
      lead.crm_cliente_record_id,
    );
    if (actual) {
      const cambios = soloLoQueFalta(deseados, actual, config.autorId);
      if (Object.keys(cambios).length === 0) return { registro: actual, estado: "actualizado" };
      const registro = await actualizarRegistro(
        config.apiKey,
        config.baseClientes,
        config.tablaClientes,
        actual.id,
        cambios,
      );
      return { registro, estado: "actualizado" };
    }
    // Si el registro ya no existe (lo borraron en Airtable) se sigue de largo y
    // se vuelve a buscar o a crear.
  }

  // b) Ya hay un cliente con ese mismo nombre: el lead se cuelga de él.
  const homonimo = await clientePorNombre(nombre, config);
  if (homonimo) {
    const cambios = soloLoQueFalta(deseados, homonimo, config.autorId);
    if (Object.keys(cambios).length === 0) return { registro: homonimo, estado: "vinculado" };
    const registro = await actualizarRegistro(
      config.apiKey,
      config.baseClientes,
      config.tablaClientes,
      homonimo.id,
      cambios,
    );
    return { registro, estado: "vinculado" };
  }

  // c) Cliente nuevo. El serial (ID) lo genera Airtable con una fórmula.
  const registro = await crearRegistro(config.apiKey, config.baseClientes, config.tablaClientes, {
    ...deseados,
    [CLIENTE.estado]: "Activo",
  });
  return { registro, estado: "creado" };
}

/**
 * Busca un cliente por nombre. Se traen todos y se comparan normalizados (sin
 * tildes ni mayúsculas) porque `filterByFormula` compara literal y "Agrícola"
 * no encontraría a "AGRICOLA".
 */
async function clientePorNombre(nombre: string, config: ConfigCrm): Promise<AirtableRecord | null> {
  const registros = await listarRegistros(config.apiKey, config.baseClientes, config.tablaClientes, {
    fields: Object.values(CLIENTE),
  });
  const buscado = normalizarNombre(nombre);
  return registros.find((r) => normalizarNombre(texto(r.fields[CLIENTE.nombre]) ?? "") === buscado) ?? null;
}

/**
 * La persona con la que habló el bot, como contacto del cliente. Devuelve su
 * record id, o null si todavía no hay nombre de persona que registrar.
 */
async function sincronizarContacto(lead: Lead, clienteRecordId: string, config: ConfigCrm): Promise<string | null> {
  const nombre = limpio(lead.nombre);
  if (!nombre) return null;

  const telefono = telefonoDe(lead);
  const correo = limpio(lead.correo);

  if (lead.crm_contacto_record_id) {
    const actual = await obtenerRegistro(
      config.apiKey,
      config.baseClientes,
      config.tablaPersonalCliente,
      lead.crm_contacto_record_id,
    );
    if (actual) {
      const cambios: Record<string, unknown> = {};
      if (correo && !texto(actual.fields[CONTACTO.email])) cambios[CONTACTO.email] = correo;
      if (telefono && !texto(actual.fields[CONTACTO.telefono])) cambios[CONTACTO.telefono] = telefono;
      if (Object.keys(cambios).length === 0) return actual.id;
      if (config.autorId) cambios[CONTACTO.modificadoPor] = config.autorId;
      const registro = await actualizarRegistro(
        config.apiKey,
        config.baseClientes,
        config.tablaPersonalCliente,
        actual.id,
        cambios,
      );
      return registro.id;
    }
  }

  // Si el cliente ya tiene a esta persona —por nombre, correo o teléfono— se
  // reusa en vez de crear un duplicado.
  const existente = await contactoExistente(clienteRecordId, { nombre, correo, telefono }, config);
  if (existente) return existente.id;

  const registro = await crearRegistro(config.apiKey, config.baseClientes, config.tablaPersonalCliente, {
    [CONTACTO.nombre]: nombre,
    [CONTACTO.cliente]: [clienteRecordId],
    [CONTACTO.email]: correo ?? "",
    [CONTACTO.telefono]: telefono ?? "",
    [CONTACTO.estado]: "Activo",
    [CONTACTO.creadoPor]: config.autorId,
    [CONTACTO.modificadoPor]: config.autorId,
  });
  return registro.id;
}

async function contactoExistente(
  clienteRecordId: string,
  persona: { nombre: string; correo: string | null; telefono: string | null },
  config: ConfigCrm,
): Promise<AirtableRecord | null> {
  const registros = await listarRegistros(config.apiKey, config.baseClientes, config.tablaPersonalCliente, {
    fields: [CONTACTO.nombre, CONTACTO.email, CONTACTO.telefono, CONTACTO.cliente],
  });
  const buscado = normalizarNombre(persona.nombre);

  return (
    registros.find((r) => {
      const vinculos = Array.isArray(r.fields[CONTACTO.cliente]) ? (r.fields[CONTACTO.cliente] as unknown[]) : [];
      if (!vinculos.includes(clienteRecordId)) return false;
      if (normalizarNombre(texto(r.fields[CONTACTO.nombre]) ?? "") === buscado) return true;
      if (persona.correo && texto(r.fields[CONTACTO.email])?.toLowerCase() === persona.correo.toLowerCase()) return true;
      if (persona.telefono && soloDigitos(texto(r.fields[CONTACTO.telefono])) === soloDigitos(persona.telefono)) {
        return true;
      }
      return false;
    }) ?? null
  );
}

function soloDigitos(valor: string | null): string {
  return valor?.replace(/\D/g, "") ?? "";
}

/* ---------------------------- Eliminación de datos ----------------------- */

/**
 * Cuando alguien pide que borremos sus datos (Habeas Data), su ficha en el CRM
 * no se puede borrar —las visitas y los pedidos la referencian por serial—,
 * así que se inactiva y se le quitan los datos de contacto personales.
 *
 * Solo se toca la ficha que el bot enlazó con ese lead. Si un asesor ya
 * trabajó ese cliente tendrá que revisarla él: inactivarla es hasta donde
 * puede llegar el bot sin borrar historia comercial.
 */
export async function darDeBajaEnCrm(lead: Lead): Promise<boolean> {
  const config = configCrm();
  if (!config || !lead.crm_cliente_record_id) return false;

  try {
    if (lead.crm_contacto_record_id) {
      await actualizarRegistro(
        config.apiKey,
        config.baseClientes,
        config.tablaPersonalCliente,
        lead.crm_contacto_record_id,
        {
          [CONTACTO.email]: "",
          [CONTACTO.telefono]: "",
          [CONTACTO.estado]: "Inactivo",
          [CONTACTO.modificadoPor]: config.autorId,
        },
      );
    }

    await actualizarRegistro(config.apiKey, config.baseClientes, config.tablaClientes, lead.crm_cliente_record_id, {
      [CLIENTE.estado]: "Inactivo",
      [CLIENTE.observaciones]: "El titular pidió por WhatsApp la eliminación de sus datos. Ficha inactivada por el bot.",
      [CLIENTE.modificadoPor]: config.autorId,
    });
    return true;
  } catch (err) {
    console.error(`[crm] No se pudo dar de baja ${lead.crm_cliente_record_id}:`, err);
    return false;
  }
}
