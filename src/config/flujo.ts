// Textos y opciones del flujo guiado (QR de ferias).
// Edita aquí lo que dice el bot. Límites de WhatsApp:
// - Título de botón: máx. 20 caracteres (máx. 3 botones por mensaje).
// - Título de opción de lista: máx. 24 caracteres.

/** Frases del mensaje prescrito de cada QR. Si el mensaje del cliente la contiene, se guarda el origen. */
export const ORIGENES = [
  { frase: "conferencia de palma 2026", origen: "conferencia_palma_2026" },
];

/** Mensaje prescrito del QR de la Conferencia de Palma 2026. */
export const MENSAJE_QR_PALMA_2026 =
  "Hola, vengo de la Conferencia de Palma 2026 y quiero información sobre biochar y biológicos.";

export const TEXTOS = {
  saludo:
    "¡Qué bueno tenerte por acá! 🌱 Somos *Sirius Regenerative*: producimos biochar y biológicos en Barranca de Upía.\n\n" +
    "Te hago 4 preguntas rápidas y te paso la información que te sirve para tu cultivo. ¿Empezamos?",
  btnEmpezar: "Sí, empecemos",
  btnSoloFichas: "Solo fichas técnicas",

  nombre: "Perfecto. ¿Cuál es tu nombre?",
  empresa: (nombre: string) => `Gracias, ${nombre}. ¿En qué empresa o finca trabajas?`,

  habeasData: (politicaUrl: string) =>
    "Al continuar, autorizas el tratamiento de tus datos para contactarte con fines comerciales. " +
    `Puedes pedir su eliminación cuando quieras escribiendo a este mismo chat. Política: ${politicaUrl}`,
  correo: "¿A qué correo te enviamos la información técnica?",
  correoIncompleto: "Creo que el correo quedó incompleto, ¿me lo confirmas?",
  btnSinCorreo: "Prefiero no darlo",

  etapa: "¿Sobre cuál etapa quieres información?",
  etapaBotonLista: "Ver etapas",

  hectareas: "¿Cuántas hectáreas manejas?",

  municipio: "¿En qué municipio está el cultivo?",
  departamentoNoEncontrado: (municipio: string) =>
    `No encontré "${municipio}" en mi listado. ¿En qué departamento queda?`,
  departamentoVarios: (municipio: string) => `Hay varios municipios llamados ${municipio}. ¿En qué departamento queda?`,

  fichas: (nombre: string) => `Listo, ${nombre}. Ya tengo todo. ¿Te envío las fichas técnicas de nuestros productos?`,
  btnFichasSi: "Sí, envíamelas",
  btnFichasNo: "No por ahora",
  aquiVan: "Aquí van 👇",
  fichasNoDisponibles: "En este momento no tengo las fichas a mano 🙏 Un asesor te las envía.",

  cierreCorreo: (correo: string) => `También te llegaron al correo ${correo}.`,
  cierre:
    "Un asesor te contacta esta semana para revisar tu caso. Si quieres adelantar algo, escríbeme por acá cuando gustes.",
  cierreSoloFichas: (politicaUrl: string) =>
    "Si quieres que un asesor revise tu caso, escríbeme por acá cuando gustes.\n\n" +
    "_Guardamos tu número para contactarte con fines comerciales. Puedes pedir su eliminación escribiendo a este mismo chat. " +
    `Política: ${politicaUrl}_`,

  // Primera respuesta inesperada: se recuerda cómo responder y se repite la pregunta.
  usaOpciones: "Toca una de las opciones 👇",
  soloTexto: "Por ahora solo puedo leer texto 🙏",
  // Segunda respuesta inesperada seguida.
  asesor: "Un asesor se va a comunicar contigo.",

  datosEliminados: "Listo, eliminamos tus datos de nuestra base. Si vuelves a escribir, empezamos de cero.",
};

export const ETAPAS = [
  { id: "areas_productivas", title: "Áreas productivas" },
  { id: "siembras_resiembras", title: "Siembras o resiembras" },
  { id: "viveros", title: "Viveros" },
  { id: "varias", title: "Más de una" },
] as const;

export const HECTAREAS = [
  { id: "hasta_50", title: "Hasta 50 ha" },
  { id: "50_300", title: "50 – 300 ha" },
  { id: "mas_300", title: "Más de 300 ha" },
] as const;

/** Nombre con el que llega el PDF al cliente. */
export const FICHAS_NOMBRE_ARCHIVO = "Fichas técnicas Sirius Regenerative.pdf";
