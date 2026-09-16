import Link from "next/link";
import { requerirAsesor } from "@/lib/asesores-auth";
import {
  ESTADO_TEXTO,
  VISTAS,
  estadoDe,
  etapaTexto,
  fechaTexto,
  hectareasTexto,
  listarLeads,
  nombreDe,
  origenTexto,
  pasoTexto,
  telefonoTexto,
  whatsappUrl,
  type Vista,
} from "@/lib/asesores-data";
import { marcarAtendido } from "./actions";
import styles from "./asesores.module.css";

export default async function AsesoresPage(props: PageProps<"/asesores">) {
  const sesion = await requerirAsesor();
  const params = await props.searchParams;
  const vistaParam = typeof params.vista === "string" ? params.vista : "";
  const vista: Vista = VISTAS.some((v) => v.id === vistaParam) ? (vistaParam as Vista) : "por_atender";
  const q = typeof params.q === "string" ? params.q : "";

  const { leads, conteos } = await listarLeads(vista, q);

  return (
    <main className={styles.main}>
      <nav className={styles.tabs}>
        {VISTAS.map((v) => (
          <Link
            key={v.id}
            href={`/asesores?vista=${v.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`${styles.tab} ${v.id === vista ? styles.tabActiva : ""}`}
          >
            {v.titulo}
            <span className={styles.contador}>{conteos[v.id]}</span>
          </Link>
        ))}
      </nav>

      <div className={styles.barra}>
        <form className={styles.buscar} action="/asesores">
          <input type="hidden" name="vista" value={vista} />
          <input
            className={styles.input}
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre, finca, municipio o teléfono"
            type="search"
          />
          <button className={styles.boton} type="submit">
            Buscar
          </button>
        </form>
        {/* Descarga de archivo (route handler), no una página: <Link> no aplica. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={styles.boton} href="/asesores/exportar">
          Descargar Excel
        </a>
      </div>

      {leads.length === 0 ? (
        <div className={styles.vacio}>
          {q ? "No hay resultados para esa búsqueda." : vista === "por_atender" ? "No hay clientes por atender. 🎉" : "No hay clientes aquí todavía."}
        </div>
      ) : (
        <div className={styles.lista}>
          {leads.map((lead) => {
            const estado = estadoDe(lead);
            const ubicacion = [lead.municipio, lead.departamento].filter(Boolean).join(", ");
            return (
              <article key={lead.id} className={`${styles.tarjeta} ${estado === "asesor" ? styles.tarjetaAsesor : ""}`}>
                <div className={styles.tarjetaArriba}>
                  <div>
                    <Link href={`/asesores/${lead.id}`} className={styles.nombre}>
                      {nombreDe(lead)}
                    </Link>
                    <div className={styles.sub}>
                      {lead.empresa ? `${lead.empresa} · ` : ""}
                      {telefonoTexto(lead.wa_id)}
                    </div>
                  </div>
                  <span className={`${styles.badge} ${styles[`badge_${estado}`]}`}>{ESTADO_TEXTO[estado]}</span>
                </div>

                {estado === "asesor" && lead.motivo_asesor && <div className={styles.aviso}>{lead.motivo_asesor}</div>}

                <div className={styles.datosCortos}>
                  {ubicacion && <span className={styles.chip}>📍 {ubicacion}</span>}
                  {etapaTexto(lead.etapa) && <span className={styles.chip}>🌱 {etapaTexto(lead.etapa)}</span>}
                  {hectareasTexto(lead.hectareas) && <span className={styles.chip}>{hectareasTexto(lead.hectareas)}</span>}
                  {estado === "en_curso" && <span className={styles.chip}>{pasoTexto(lead)}</span>}
                  {lead.notas && <span className={styles.chip}>📝 Tiene notas</span>}
                </div>

                <div className={styles.sub}>
                  {origenTexto(lead.origen)} · {fechaTexto(lead.created_at)}
                  {lead.atendido_por && ` · Atendió ${lead.atendido_por}`}
                </div>

                <div className={styles.acciones}>
                  <a
                    className={`${styles.boton} ${styles.botonWhatsapp} ${styles.botonChico}`}
                    href={whatsappUrl(lead, sesion.nombre)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp
                  </a>
                  <Link className={`${styles.boton} ${styles.botonChico}`} href={`/asesores/${lead.id}`}>
                    Ver detalle
                  </Link>
                  {estado !== "atendido" && estado !== "en_curso" && (
                    <form action={marcarAtendido}>
                      <input type="hidden" name="id" value={lead.id} />
                      <button className={`${styles.boton} ${styles.botonChico}`} type="submit">
                        ✓ Atendido
                      </button>
                    </form>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
