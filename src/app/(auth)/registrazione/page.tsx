import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Field, Form, FormMessage, Submit } from "@/components/form";
import { register } from "@/server/auth-actions";
import { firstInstall } from "@/server/marina-setup";

export const metadata: Metadata = { title: "Registra il tuo porto" };

// La registrazione serve solo alla prima installazione (nessun porto nel database): poi i porti li crea l'account manager.
async function RegisterForm() {
  await connection();
  if (!(await firstInstall())) {
    return (
      <p className="mt-6 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
        I nuovi porti li attiva Omnia Marina, che crea anche l&apos;accesso del direttore. Se il tuo porto è già attivo, accedi con le credenziali ricevute.
      </p>
    );
  }
  return (
    <Form action={register} className="mt-6 space-y-4">
      <Field name="marinaName" label="Nome del porto" placeholder="Es. Marina di Levante" required />
      <Field name="name" label="Il tuo nome e cognome" autoComplete="name" required />
      <Field name="email" label="Email" type="email" autoComplete="username" required />
      <Field name="password" label="Password" type="password" autoComplete="new-password" hint="Almeno 10 caratteri." required />
      <FormMessage />
      <Submit className="w-full">Crea il porto</Submit>
    </Form>
  );
}

export default function RegisterPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Registra il tuo porto</h1>
      <p className="mt-1 text-[15px] text-muted">Crea lo spazio del porto e il tuo accesso come direzione. Potrai poi aggiungere ufficio e operatori di banchina.</p>
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
      <p className="mt-6 text-sm text-muted">
        Hai già un account?{" "}
        <Link href="/login" className="link">
          Accedi
        </Link>
      </p>
    </>
  );
}
