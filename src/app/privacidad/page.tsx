import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de tratamiento de datos — Sirius Regenerative",
  description: "Cómo Sirius Regenerative trata los datos personales que recibe por WhatsApp (Ley 1581 de 2012).",
};

// Borrador base. Revísalo con asesoría legal.
export default function Privacidad() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px", lineHeight: 1.6, fontFamily: "system-ui, sans-serif" }}>
      <h1>Política de tratamiento de datos personales</h1>
      <p>
        <strong>Sirius Regenerative Solutions S.A.S. ZOMAC</strong>, NIT 901.377.064-8, con domicilio en el Km 7 vía
        Cabuyaro, Barranca de Upía (Meta), Colombia, es responsable del
        tratamiento de los datos personales que recibe a través de su canal de WhatsApp, en cumplimiento de la Ley 1581 de
        2012 y el Decreto 1377 de 2013.
      </p>

      <h2>Qué datos recogemos</h2>
      <p>
        Número de WhatsApp, nombre, empresa o finca, correo electrónico (opcional), etapa del cultivo, rango de hectáreas y
        municipio y departamento del cultivo.
      </p>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Enviarte las fichas técnicas e información de nuestros productos.</li>
        <li>Contactarte con fines comerciales para revisar tu caso y ofrecerte nuestros productos.</li>
        <li>Llevar registro de los contactos recibidos en ferias y eventos.</li>
      </ul>
      <p>No vendemos tus datos ni los compartimos con terceros para fines distintos a los descritos.</p>

      <h2>Tus derechos</h2>
      <p>
        Puedes conocer, actualizar y rectificar tus datos, pedir prueba de la autorización, ser informado sobre su uso,
        revocar la autorización o pedir que los eliminemos, y presentar quejas ante la Superintendencia de Industria y
        Comercio.
      </p>

      <h2>Cómo ejercerlos</h2>
      <p>
        Escríbenos al mismo chat de WhatsApp por el que nos contactaste o al correo{" "}
        <a href="mailto:direccion.comercial@siriusregenerative.com">direccion.comercial@siriusregenerative.com</a>. Si escribes <em>“borrar mis datos”</em>, los
        eliminamos de inmediato. Las consultas se responden en máximo 10 días hábiles y los reclamos en máximo 15 días
        hábiles.
      </p>

      <h2>Vigencia</h2>
      <p>Esta política rige desde septiembre de 2026. Conservamos los datos mientras exista la finalidad que los justifica.</p>
    </main>
  );
}
