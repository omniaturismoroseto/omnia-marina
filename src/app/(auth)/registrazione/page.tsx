import type { Metadata } from "next";
import Link from "next/link";
import { Field, Form, FormMessage, Submit } from "@/components/form";
import { register } from "@/server/auth-actions";

export const metadata: Metadata = { title: "Registra il tuo porto" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Registra il tuo porto</h1>
      <p className="mt-1 text-[15px] text-muted">Crea lo spazio del porto e il tuo accesso come direzione. Potrai poi aggiungere ufficio e operatori di banchina.</p>
      <Form action={register} className="mt-6 space-y-4">
        <Field name="marinaName" label="Nome del porto" placeholder="Es. Marina di Levante" required />
        <Field name="name" label="Il tuo nome e cognome" autoComplete="name" required />
        <Field name="email" label="Email" type="email" autoComplete="username" required />
        <Field name="password" label="Password" type="password" autoComplete="new-password" hint="Almeno 10 caratteri." required />
        <FormMessage />
        <Submit className="w-full">Crea il porto</Submit>
      </Form>
      <p className="mt-6 text-sm text-muted">
        Hai già un account?{" "}
        <Link href="/login" className="link">
          Accedi
        </Link>
      </p>
    </>
  );
}
