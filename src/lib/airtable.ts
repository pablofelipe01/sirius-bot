// Cliente HTTP mínimo sobre la REST API de Airtable, para escribir en las bases
// del CRM. Es una copia reducida del que usa sirius-crm: se duplica a propósito
// para no acoplar los dos despliegues, que no comparten código ni versión.

const AIRTABLE_API = "https://api.airtable.com/v0";

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

// Airtable corta en 5 peticiones por segundo y por base, y responde 429.
const REINTENTOS = 3;
const ESPERA_BASE_MS = 500;

function esReintentable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Espera del `Retry-After` si viene, o exponencial con algo de dispersión. */
function esperaMs(respuesta: Response, intento: number): number {
  const cabecera = Number(respuesta.headers.get("retry-after"));
  if (Number.isFinite(cabecera) && cabecera > 0) return Math.min(cabecera * 1000, 30_000);
  return Math.min(ESPERA_BASE_MS * 2 ** intento + Math.random() * 250, 8_000);
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function pedir<T>(apiKey: string, baseId: string, path: string, init?: RequestInit): Promise<T> {
  let ultimoDetalle = "";
  let ultimoStatus = 0;

  for (let intento = 0; intento <= REINTENTOS; intento += 1) {
    const response = await fetch(`${AIRTABLE_API}/${baseId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });

    if (response.ok) return response.json() as Promise<T>;

    ultimoStatus = response.status;
    ultimoDetalle = await response.text();
    if (!esReintentable(response.status) || intento === REINTENTOS) break;

    const espera = esperaMs(response, intento);
    console.warn(`[airtable] ${response.status} en ${path.slice(0, 60)} · reintento ${intento + 1}/${REINTENTOS} en ${Math.round(espera)}ms`);
    await dormir(espera);
  }

  throw new Error(`Airtable ${ultimoStatus}: ${ultimoDetalle.slice(0, 300)}`);
}

export interface OpcionesListado {
  fields?: string[];
  filterByFormula?: string;
  maxRecords?: number;
}

/** Trae registros paginando hasta agotar el offset. */
export async function listarRegistros(
  apiKey: string,
  baseId: string,
  tableId: string,
  opciones: OpcionesListado = {},
): Promise<AirtableRecord[]> {
  const registros: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (opciones.filterByFormula) params.set("filterByFormula", opciones.filterByFormula);
    if (opciones.maxRecords) params.set("maxRecords", String(opciones.maxRecords));
    if (offset) params.set("offset", offset);
    for (const campo of opciones.fields ?? []) params.append("fields[]", campo);

    const data = await pedir<{ records: AirtableRecord[]; offset?: string }>(
      apiKey,
      baseId,
      `/${encodeURIComponent(tableId)}?${params}`,
    );
    registros.push(...data.records);
    offset = data.offset;
  } while (offset && (!opciones.maxRecords || registros.length < opciones.maxRecords));

  return registros;
}

export async function obtenerRegistro(
  apiKey: string,
  baseId: string,
  tableId: string,
  recordId: string,
): Promise<AirtableRecord | null> {
  const registros = await listarRegistros(apiKey, baseId, tableId, {
    filterByFormula: `RECORD_ID() = '${recordId}'`,
    maxRecords: 1,
  });
  return registros[0] ?? null;
}

export async function crearRegistro(
  apiKey: string,
  baseId: string,
  tableId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const data = await pedir<{ records: AirtableRecord[] }>(apiKey, baseId, `/${encodeURIComponent(tableId)}`, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  return data.records[0];
}

export async function actualizarRegistro(
  apiKey: string,
  baseId: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const data = await pedir<{ records: AirtableRecord[] }>(apiKey, baseId, `/${encodeURIComponent(tableId)}`, {
    method: "PATCH",
    body: JSON.stringify({ records: [{ id: recordId, fields }], typecast: true }),
  });
  return data.records[0];
}

/** Normaliza el valor de una celda a texto (maneja selects, lookups y links). */
export function texto(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return texto(value[0]);
  if (value && typeof value === "object" && "name" in value) return texto((value as { name: unknown }).name);
  return null;
}
