import { ETAPAS, FICHAS_NOMBRE_ARCHIVO, HECTAREAS, ORIGENES, TEXTOS } from "@/config/flujo";
import { buscarDepartamento, buscarMunicipio, municipioEnDepartamento, normalize } from "./municipios";
import { emptyLead, type Lead, type LeadPatch } from "./store";
import type { Button, ListRow } from "./whatsapp";

// Flujo guiado para leads que llegan por QR:
// inicio → nombre → empresa → correo (→ correo_reintento) → etapa → hectareas → municipio (→ departamento) → fichas → completo.
// Si alguien responde algo inesperado dos veces seguidas, pasa a "asesor". En "completo" y "asesor" responde la IA.

export type Entrada =
  | { tipo: "texto"; texto: string }
  | { tipo: "opcion"; id: string; titulo: string }
  | { tipo: "otro" }; // audio, imagen, sticker…

export interface Canal {
  text(body: string): Promise<void>;
  buttons(body: string, buttons: Button[]): Promise<void>;
  list(body: string, buttonText: string, rows: ListRow[]): Promise<void>;
  document(link: string, filename: string): Promise<void>;
}

export interface FlowDeps {
  canal: Canal;
  saveLead(patch: LeadPatch): Promise<void>;
  deleteContact(): Promise<void>;
  fichasUrl: string | undefined;
  politicaUrl: string;
  enviarCorreo(to: string, nombre: string | null, fichasUrl: string): Promise<boolean>;
  now(): string;
  /** Nombre del perfil de WhatsApp, si llegó en el webhook. */
  nombrePerfil?: string;
}

type Paso =
  | "inicio"
  | "nombre"
  | "empresa"
  | "correo"
  | "correo_reintento"
  | "etapa"
  | "hectareas"
  | "municipio"
  | "departamento"
  | "fichas"
  | "completo"
  | "asesor";

const ID = {
  empezar: "empezar",
  soloFichas: "solo_fichas",
  sinCorreo: "sin_correo",
  fichasSi: "fichas_si",
  fichasNo: "fichas_no",
};

const PASOS_CON_OPCIONES: Paso[] = ["inicio", "correo", "correo_reintento", "etapa", "hectareas", "fichas"];

const RE = {
  eliminarDatos: /\b(elimin|borr|suprim)\w*\b.*\b(datos|informacion|numero)\b/,
  pideAsesor: /\b(asesor|asesora|humano|una persona)\b/,
  si: /^(si+|dale|listo|ok|okay|claro|de una|bueno|vamos|hagale|por favor|si (claro|gracias|por favor|empecemos|envie(me)?las))$/,
  no: /^(no|no gracias|no por ahora|ahora no|despues|luego|mas tarde)$/,
  soloFichas: /\b(fichas?|pdf)\b/,
  sinCorreo: /^(no|no gracias|prefiero no\b.*|sin correo|no tengo\b.*|paso)$/,
  correo: /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i,
};

/**
 * Procesa un mensaje dentro del flujo guiado. Devuelve true si el flujo ya respondió;
 * false si el mensaje debe ir a la IA (conversación libre después del flujo).
 */
export async function procesarFlujo(actual: Lead | null, waId: string, entrada: Entrada, deps: FlowDeps): Promise<boolean> {
  const texto = entrada.tipo === "texto" ? entrada.texto.trim() : "";
  const n = normalize(texto);

  let lead = actual ?? emptyLead(waId);
  const guardar = async (patch: LeadPatch) => {
    lead = { ...lead, ...patch };
    await deps.saveLead(patch);
  };

  if (RE.eliminarDatos.test(n)) {
    await deps.deleteContact();
    await deps.canal.text(TEXTOS.datosEliminados);
    return true;
  }

  // Número nuevo, o alguien que vuelve a escanear el QR: empieza desde el saludo.
  const origen = ORIGENES.find((o) => n.includes(normalize(o.frase)))?.origen;
  if (!actual || origen) {
    await guardar({
      paso: "inicio",
      intentos_fallidos: 0,
      origen: origen ?? lead.origen,
      nombre_perfil: deps.nombrePerfil ?? lead.nombre_perfil,
    });
    await preguntar("inicio", lead, deps);
    return true;
  }

  const paso = lead.paso as Paso;

  if (paso !== "asesor" && RE.pideAsesor.test(n)) {
    await pasarAAsesor(guardar, deps, "pidió hablar con un asesor");
    return true;
  }

  const siguiente = async (patch: LeadPatch, proximo: Paso) => {
    await guardar({ ...patch, paso: proximo, intentos_fallidos: 0 });
    await preguntar(proximo, lead, deps);
    return true;
  };

  const inesperada = async () => {
    if (lead.intentos_fallidos >= 1) {
      await pasarAAsesor(guardar, deps, `respuesta inesperada en el paso "${paso}"`);
      return true;
    }
    await guardar({ intentos_fallidos: lead.intentos_fallidos + 1 });
    const prefijo =
      entrada.tipo === "otro" ? TEXTOS.soloTexto : PASOS_CON_OPCIONES.includes(paso) ? TEXTOS.usaOpciones : "";
    await preguntar(paso, lead, deps, prefijo);
    return true;
  };

  switch (paso) {
    case "completo":
    case "asesor": {
      // Botones viejos de fichas siguen funcionando; lo demás lo responde la IA.
      if (entrada.tipo === "opcion" && (entrada.id === ID.fichasSi || entrada.id === ID.soloFichas)) {
        await enviarFichas(lead, guardar, deps);
        return true;
      }
      return false;
    }

    case "inicio": {
      if (esOpcion(entrada, ID.empezar) || RE.si.test(n)) return siguiente({}, "nombre");
      if (esOpcion(entrada, ID.soloFichas) || RE.soloFichas.test(n)) {
        await enviarFichas(lead, guardar, deps);
        await deps.canal.text(TEXTOS.cierreSoloFichas(deps.politicaUrl));
        await guardar({ paso: "completo", intentos_fallidos: 0 });
        return true;
      }
      return inesperada();
    }

    case "nombre":
      if (texto && texto.length <= 80) return siguiente({ nombre: texto }, "empresa");
      return inesperada();

    case "empresa":
      if (texto && texto.length <= 150) return siguiente({ empresa: texto }, "correo");
      return inesperada();

    case "correo":
    case "correo_reintento": {
      const autoriza = { autoriza_datos_en: lead.autoriza_datos_en ?? deps.now() };
      if (esOpcion(entrada, ID.sinCorreo) || RE.sinCorreo.test(n)) {
        return siguiente({ ...autoriza, correo: null }, "etapa");
      }
      if (entrada.tipo !== "texto") return inesperada();
      const correo = texto.match(RE.correo)?.[0].toLowerCase();
      if (correo) return siguiente({ ...autoriza, correo, correo_sin_validar: null }, "etapa");
      if (paso === "correo") return siguiente({}, "correo_reintento");
      // Segundo intento fallido: se guarda lo que escribió y se sigue; no vale la pena perder el lead.
      return siguiente({ ...autoriza, correo_sin_validar: texto }, "etapa");
    }

    case "etapa": {
      const etapa = elegirEtapa(entrada, n);
      if (etapa) return siguiente({ etapa }, "hectareas");
      return inesperada();
    }

    case "hectareas": {
      const hectareas = elegirHectareas(entrada, n);
      if (hectareas) return siguiente({ hectareas }, "municipio");
      return inesperada();
    }

    case "municipio": {
      if (!texto || texto.length > 120) return inesperada();
      const match = buscarMunicipio(texto);
      if (match.estado === "unico") {
        return siguiente(
          { municipio: match.municipio, departamento: match.departamento, municipio_encontrado: true },
          "fichas",
        );
      }
      if (match.estado === "varios") {
        return siguiente({ municipio: match.municipio, departamento: null, municipio_encontrado: null }, "departamento");
      }
      return siguiente({ municipio: texto, departamento: null, municipio_encontrado: false }, "departamento");
    }

    case "departamento": {
      if (!texto || texto.length > 120) return inesperada();
      const departamento = buscarDepartamento(texto);
      const encontrado = Boolean(
        departamento && lead.municipio && municipioEnDepartamento(lead.municipio, departamento),
      );
      return siguiente({ departamento: departamento ?? texto, municipio_encontrado: encontrado }, "fichas");
    }

    case "fichas": {
      if (esOpcion(entrada, ID.fichasSi) || RE.si.test(n)) {
        const enviadas = await enviarFichas(lead, guardar, deps);
        let cierre = TEXTOS.cierre;
        if (enviadas && lead.correo && deps.fichasUrl && (await deps.enviarCorreo(lead.correo, lead.nombre, deps.fichasUrl))) {
          await guardar({ correo_enviado_en: deps.now() });
          cierre = `${TEXTOS.cierreCorreo(lead.correo)}\n\n${cierre}`;
        }
        await deps.canal.text(cierre);
        await guardar({ paso: "completo", intentos_fallidos: 0, completado_en: deps.now() });
        return true;
      }
      if (esOpcion(entrada, ID.fichasNo) || RE.no.test(n)) {
        await deps.canal.text(TEXTOS.cierre);
        await guardar({ paso: "completo", intentos_fallidos: 0, completado_en: deps.now() });
        return true;
      }
      return inesperada();
    }

    default:
      // Paso desconocido (p. ej. datos viejos): se reinicia el flujo.
      await guardar({ paso: "inicio", intentos_fallidos: 0 });
      await preguntar("inicio", lead, deps);
      return true;
  }
}

async function preguntar(paso: Paso, lead: Lead, deps: FlowDeps, prefijo = ""): Promise<void> {
  const conPrefijo = (body: string) => (prefijo ? `${prefijo}\n\n${body}` : body);
  const { canal } = deps;
  switch (paso) {
    case "inicio":
      return canal.buttons(conPrefijo(TEXTOS.saludo), [
        { id: ID.empezar, title: TEXTOS.btnEmpezar },
        { id: ID.soloFichas, title: TEXTOS.btnSoloFichas },
      ]);
    case "nombre":
      return canal.text(conPrefijo(TEXTOS.nombre));
    case "empresa":
      return canal.text(conPrefijo(TEXTOS.empresa(lead.nombre ?? "")));
    case "correo":
      // El aviso de Habeas Data va antes de pedir el correo (solo la primera vez).
      if (!prefijo) await canal.text(TEXTOS.habeasData(deps.politicaUrl));
      return canal.buttons(conPrefijo(TEXTOS.correo), [{ id: ID.sinCorreo, title: TEXTOS.btnSinCorreo }]);
    case "correo_reintento":
      return canal.buttons(conPrefijo(TEXTOS.correoIncompleto), [{ id: ID.sinCorreo, title: TEXTOS.btnSinCorreo }]);
    case "etapa":
      return canal.list(conPrefijo(TEXTOS.etapa), TEXTOS.etapaBotonLista, [...ETAPAS]);
    case "hectareas":
      return canal.buttons(conPrefijo(TEXTOS.hectareas), [...HECTAREAS]);
    case "municipio":
      return canal.text(conPrefijo(TEXTOS.municipio));
    case "departamento": {
      const municipio = lead.municipio ?? "";
      const body =
        lead.municipio_encontrado === null
          ? TEXTOS.departamentoVarios(municipio)
          : TEXTOS.departamentoNoEncontrado(municipio);
      return canal.text(conPrefijo(body));
    }
    case "fichas":
      return canal.buttons(conPrefijo(TEXTOS.fichas(lead.nombre ?? "")), [
        { id: ID.fichasSi, title: TEXTOS.btnFichasSi },
        { id: ID.fichasNo, title: TEXTOS.btnFichasNo },
      ]);
    case "completo":
    case "asesor":
      return;
  }
}

async function enviarFichas(lead: Lead, guardar: (patch: LeadPatch) => Promise<void>, deps: FlowDeps): Promise<boolean> {
  const url = deps.fichasUrl;
  if (!url) {
    console.error("[flow] Falta FICHAS_URL: no se pudieron enviar las fichas.");
    await deps.canal.text(TEXTOS.fichasNoDisponibles);
    await guardar({ requiere_asesor: true, motivo_asesor: lead.motivo_asesor ?? "enviar fichas técnicas (FICHAS_URL sin configurar)" });
    return false;
  }
  await deps.canal.text(TEXTOS.aquiVan);
  if (new URL(url).pathname.toLowerCase().endsWith(".pdf")) {
    await deps.canal.document(url, FICHAS_NOMBRE_ARCHIVO);
  } else {
    await deps.canal.text(url); // carpeta de Drive u otro enlace
  }
  await guardar({ fichas_enviadas_en: deps.now() });
  return true;
}

async function pasarAAsesor(guardar: (patch: LeadPatch) => Promise<void>, deps: FlowDeps, motivo: string) {
  await guardar({ paso: "asesor", intentos_fallidos: 0, requiere_asesor: true, motivo_asesor: motivo });
  await deps.canal.text(TEXTOS.asesor);
}

function esOpcion(entrada: Entrada, id: string): boolean {
  return entrada.tipo === "opcion" && entrada.id === id;
}

function elegirEtapa(entrada: Entrada, n: string): string | null {
  if (entrada.tipo === "opcion") return ETAPAS.find((e) => e.id === entrada.id)?.id ?? null;
  const exacta = ETAPAS.find((e) => normalize(e.title) === n);
  if (exacta) return exacta.id;
  if (/\b(varias|todas|ambas|las dos|las tres|mas de una)\b/.test(n)) return "varias";
  const menciones = [
    /productiv/.test(n) && "areas_productivas",
    /siembra/.test(n) && "siembras_resiembras",
    /vivero/.test(n) && "viveros",
  ].filter((x): x is string => Boolean(x));
  if (menciones.length > 1) return "varias";
  return menciones[0] ?? null;
}

function elegirHectareas(entrada: Entrada, n: string): string | null {
  if (entrada.tipo === "opcion") return HECTAREAS.find((h) => h.id === entrada.id)?.id ?? null;
  const exacta = HECTAREAS.find((h) => normalize(h.title) === n);
  if (exacta) return exacta.id;
  const numero = n.match(/\d[\d ]*/)?.[0].replace(/ /g, "");
  if (!numero) return null;
  const ha = Number(numero) + (/\bmas de\b/.test(n) ? 1 : 0);
  if (ha <= 50) return "hasta_50";
  if (ha <= 300) return "50_300";
  return "mas_300";
}
