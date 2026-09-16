"use client";

import { useActionState } from "react";
import { entrar } from "../actions";
import styles from "../asesores.module.css";

export function LoginForm() {
  const [state, action, pending] = useActionState(entrar, undefined);
  return (
    <form action={action} className={styles.login}>
      <div>
        <div className={styles.titulo}>Panel de asesores</div>
        <div className={styles.sub}>Sirius Regenerative</div>
      </div>
      <label className={styles.label}>
        Tu nombre
        <input className={styles.input} name="nombre" autoComplete="name" required maxLength={40} />
      </label>
      <label className={styles.label}>
        Contraseña
        <input className={styles.input} name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error && <p className={styles.error}>{state.error}</p>}
      <button className={`${styles.boton} ${styles.botonPrimario}`} type="submit" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
