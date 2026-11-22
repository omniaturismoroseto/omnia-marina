import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Field, Form, FormMessage, Submit } from "@/components/form";
import { currentUser } from "@/lib/context";
import { login } from "@/server/auth-actions";
import { firstInstall } from "@/server/marina-setup";

export const metadata: Metadata = { title: "Accedi" };

async function RedirectIfSignedIn() {
  if (await currentUser()) redirect("/");
  return null;
}

async function SignupLink() {
  await connection();
  // Solo alla prima installazione: poi i porti li crea l'account manager.
  if (!(await firstInstall())) return null;
  return (
    <p className="mt-6 text-sm text-muted">
      Il tuo porto non è ancora su Omnia Marina?{" "}
      <Link href="/registrazione" className="link">
        Registralo
      </Link>
    </p>
  );
}

export default function LoginPage() {
  return (
    <>
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <h1 className="font-display text-3xl font-semibold text-ink">Accedi</h1>
      <p className="mt-1 text-[15px] text-muted">Entra con le credenziali del tuo porto.</p>
      <Form action={login} className="mt-6 space-y-4">
        <Field name="email" label="Email" type="email" autoComplete="username" required />
        <Field name="password" label="Password" type="password" autoComplete="current-password" required />
        <p className="-mt-2 text-right text-sm">
          <Link href="/password-dimenticata" className="link">
            Password dimenticata?
          </Link>
        </p>
        <FormMessage />
        <Submit className="w-full">Accedi</Submit>
      </Form>
      <p className="mt-6 text-sm text-muted">
        Diportista con un codice del porto?{" "}
        <Link href="/attiva" className="link">
          Attiva l&apos;accesso
        </Link>
      </p>
      <Suspense fallback={null}>
        <SignupLink />
      </Suspense>
    </>
  );
}
