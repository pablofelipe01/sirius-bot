import Link from "next/link";
import { notFound } from "next/navigation";
import { requerirAsesor } from "@/lib/asesores-auth";
import {
  ESTADO_TEXTO,
  conversacion,
  estadoDe,
  etapaTexto,
  fechaTexto,
  hectareasTexto,
  nombreDe,
  obtenerLead,
  origenTexto,
  pasoTexto,
  telefonoTexto,
  whatsappUrl,
} from "@/lib/asesores-data";
import { guardarNotas, marcarAtendido, reabrir } from "../actions";
import styles from "../asesores.module.css";

export default async function LeadPage(props: PageProps<"/asesores/[id]">) {
  const sesion = await requerirAsesor();
  const { id } = await props.params;
  const lead = await obtenerLead(id);
  if (!lead) notFound();

  const mensajes = await conversacion(lead.wa_id);
  const estado = estadoDe(lead);
  const ubicacion = [lead.municipio, lead.departamento].filter(Boolean).join(", ");

  const datos: [string, React.ReactNode][] = [
    ["Nombre", lead.nombre],
    ["Nombre en WhatsApp", lead.nombre_perfil],
    ["Teléfono", telefonoTexto(lead.wa_id)],
    ["Empresa o finca", lead.empresa],
    [
      "Correo",
      lead.correo ? (
        <a href={`mailto:${lead.correo}`}>{lead.correo}</a>
      ) : lead.correo_sin_validar ? (
        `${lead.correo_sin_validar} (incompleto)`
      ) : null,
    ],
    ["Etapa", etapaTexto(lead.etapa)],
    ["Hectáreas", hectareasTexto(lead.hectareas)],
    ["Ubicación", ubicacion ? `${ubicacion}${lead.municipio_encontrado === false ? " (no está en el listado DANE)" : ""}` : null],
    ["Origen", origenTexto(lead.origen)],
    ["Llegó", fechaTexto(lead.created_at)],
    ["Terminó el cuestionario", lead.completado_en ? fechaTexto(lead.completado_en) : estado === "en_curso" ? pasoTexto(lead) : "No"],
    ["Fichas enviadas", lead.fichas_enviadas_en ? fechaTexto(lead.fichas_enviadas_en) : "No"],
    ["Autorizó datos", lead.autoriza_datos_en ? fechaTexto(lead.autoriza_datos_en) : "No"],
  ];

  return (
    <main className={styles.main}>
      <Link href="/asesores" className={styles.volver}>
        ← Volver a la lista
      </Link>

      <div className={styles.cabecera}>
        <div className={styles.tarjetaArriba}>
          <div>
            <h1 className={styles.titulo}>{nombreDe(lead)}</h1>
            <div className={styles.sub}>{lead.empresa ?? telefonoTexto(lead.wa_id)}</div>
          </div>
          <span className={`${styles.badge} ${styles[`badge_${estado}`]}`}>{ESTADO_TEXTO[estado]}</span>
        </div>

        {lead.requiere_asesor && lead.motivo_asesor && !lead.atendido_en && (
          <div className={styles.aviso}>{lead.motivo_asesor}</div>
        )}
        {lead.atendido_en && (
          <div className={styles.avisoOk}>
            Atendido por {lead.atendido_por ?? "un asesor"} · {fechaTexto(lead.atendido_en)}
          </div>
        )}

        <div className={styles.acciones}>
          <a
            className={`${styles.boton} ${styles.botonWhatsapp}`}
            href={whatsappUrl(lead, sesion.nombre)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Escribir por WhatsApp
          </a>
          <a className={styles.boton} href={`tel:+${lead.wa_id}`}>
            Llamar
          </a>
          {lead.correo && (
            <a className={styles.boton} href={`mailto:${lead.correo}`}>
              Enviar correo
            </a>
          )}
          {lead.atendido_en ? (
            <form action={reabrir}>
              <input type="hidden" name="id" value={lead.id} />
              <button className={styles.boton} type="submit">
                Volver a pendiente
              </button>
            </form>
          ) : (
            <form action={marcarAtendido}>
              <input type="hidden" name="id" value={lead.id} />
              <button className={`${styles.boton} ${styles.botonPrimario}`} type="submit">
                ✓ Marcar como atendido
              </button>
            </form>
          )}
        </div>
      </div>

      <div className={styles.detalleGrid}>
        <div className={styles.detalleGrid} style={{ gridTemplateColumns: "1fr" }}>
          <section className={styles.caja}>
            <h2 className={styles.cajaTitulo}>Datos</h2>
            <dl className={styles.dl}>
              {datos.map(([etiqueta, valor]) => (
                <div key={etiqueta} style={{ display: "contents" }}>
                  <dt>{etiqueta}</dt>
                  <dd>{valor ?? <span className={styles.sub}>—</span>}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles.caja}>
            <h2 className={styles.cajaTitulo}>Notas del asesor</h2>
            <form action={guardarNotas} className={styles.formNotas}>
              <input type="hidden" name="id" value={lead.id} />
              <textarea
                className={styles.textarea}
                name="notas"
                defaultValue={lead.notas ?? ""}
                placeholder="Ej.: Llamé el martes, quiere cotización de 5 t de Sirius Char para 200 ha."
                maxLength={5000}
              />
              <button className={styles.boton} type="submit">
                Guardar notas
              </button>
            </form>
          </section>
        </div>

        <section className={styles.caja}>
          <h2 className={styles.cajaTitulo}>Conversación con el bot</h2>
          {mensajes.length === 0 ? (
            <p className={styles.sub}>No hay mensajes guardados.</p>
          ) : (
            <div className={styles.chat}>
              {mensajes.map((m) => (
                <div key={m.id} className={`${styles.burbuja} ${m.rol === "user" ? styles.burbujaCliente : styles.burbujaBot}`}>
                  {m.contenido}
                  <span className={styles.hora}>{fechaTexto(m.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
