import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/asesores-auth";
import styles from "../asesores.module.css";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await leerSesion()) redirect("/asesores");
  return (
    <div className={styles.loginWrap}>
      <LoginForm />
    </div>
  );
}
