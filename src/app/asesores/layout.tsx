import type { Metadata } from "next";
import { leerSesion } from "@/lib/asesores-auth";
import { salir } from "./actions";
import styles from "./asesores.module.css";

export const metadata: Metadata = {
  title: "Panel de asesores — Sirius Regenerative",
  robots: { index: false, follow: false },
};

export default async function AsesoresLayout({ children }: LayoutProps<"/asesores">) {
  // Solo para mostrar el encabezado; cada página y acción vuelve a verificar la sesión.
  const sesion = await leerSesion();
  return (
    <div className={styles.panel}>
      {sesion && (
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.marca}>
              Sirius <span>· Asesores</span>
            </div>
            <div className={styles.usuario}>{sesion.nombre}</div>
            <form action={salir}>
              <button className={styles.botonSalir} type="submit">
                Salir
              </button>
            </form>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
