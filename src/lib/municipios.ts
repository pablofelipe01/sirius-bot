import { MUNICIPIOS } from "@/data/municipios";

/** Minúsculas, sin tildes ni signos, espacios simples. "Barranca de Upía, Meta" → "barranca de upia meta". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

const INDEX = MUNICIPIOS.map(([municipio, departamento]) => ({
  municipio,
  departamento,
  m: normalize(municipio),
  d: normalize(departamento),
}));

const RELLENO = new Set(["municipio", "de", "del", "en", "el", "la", "departamento", "dpto", "colombia", "queda", "esta", "es", "y"]);

function soloRelleno(padded: string, row: { m: string; d: string }): boolean {
  const resto = padded.replace(` ${row.m} `, " ").replace(` ${row.d} `, " ");
  return resto.split(" ").every((word) => !word || RELLENO.has(word));
}

const DEPARTAMENTOS = [...new Map(INDEX.map((row) => [row.d, row.departamento])).entries()];

export type MunicipioMatch =
  | { estado: "unico"; municipio: string; departamento: string }
  | { estado: "varios"; municipio: string; departamentos: string[] }
  | { estado: "ninguno" };

/** Busca lo que escribió el cliente en el listado del DANE. Acepta "Barranca de Upía, Meta" o "Cúcuta". */
export function buscarMunicipio(text: string): MunicipioMatch {
  const n = normalize(text);
  if (!n) return { estado: "ninguno" };
  const padded = ` ${n} `;

  let candidates = INDEX.filter((row) => row.m === n);
  if (candidates.length === 0) {
    // El nombre aparece dentro del texto ("municipio de Barranca de Upía, Meta"), pero solo si
    // lo demás es relleno o el departamento; si no, "Villa Rica del Norte" coincidiría con "Villa Rica".
    const inside = INDEX.filter((row) => padded.includes(` ${row.m} `) && soloRelleno(padded, row));
    const longest = Math.max(0, ...inside.map((row) => row.m.length));
    candidates = inside.filter((row) => row.m.length === longest);
  }
  if (candidates.length === 0 && n.length >= 4) {
    // Nombre abreviado: "Cúcuta" → "San José de Cúcuta", "Bogotá" → "Bogotá D.C.".
    candidates = INDEX.filter((row) => row.m.endsWith(` ${n}`) || row.m.startsWith(`${n} `));
  }
  if (candidates.length === 0) return { estado: "ninguno" };

  const conDepartamento = candidates.filter((row) => padded.includes(` ${row.d} `));
  if (conDepartamento.length > 0) candidates = conDepartamento;

  const nombres = new Set(candidates.map((row) => row.municipio));
  if (candidates.length === 1) {
    return { estado: "unico", municipio: candidates[0].municipio, departamento: candidates[0].departamento };
  }
  if (nombres.size > 1) return { estado: "ninguno" }; // demasiado ambiguo; se pregunta el departamento
  return {
    estado: "varios",
    municipio: candidates[0].municipio,
    departamentos: candidates.map((row) => row.departamento),
  };
}

/** Departamento mencionado en el texto (nombre oficial), o null. */
export function buscarDepartamento(text: string): string | null {
  const padded = ` ${normalize(text)} `;
  const found = DEPARTAMENTOS.filter(([d]) => padded.includes(` ${d} `)).sort((a, b) => b[0].length - a[0].length);
  return found[0]?.[1] ?? null;
}

/** El municipio dentro de un departamento, si existe con ese nombre exacto. */
export function municipioEnDepartamento(municipio: string, departamento: string): boolean {
  return INDEX.some((row) => row.municipio === municipio && row.departamento === departamento);
}
