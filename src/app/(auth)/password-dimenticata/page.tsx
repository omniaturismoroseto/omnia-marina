import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Field, Form, FormMessage, Submit } from "@/components/form";
import { requestPasswordReset } from "@/server/auth-actions";
import { firebaseEnabled } from "@/server/credentials";

export const metadata: Metadata = { title: "Password dimenticata" };

// Con Firebase attivo la nuova password si sceglie dal collegamento ricevuto per email;
// senza, la reimposta la direzione del porto.
async function ResetForm() {
  await connection();
  if (!firebaseEnabled()) {
    return (
      <p className="mt-4 text-[15px] text-muted">
        Chiedi alla direzione del porto di impostarti una password provvisoria da «Impostazioni» → «Utenti». Poi, una volta entrato, cambiala da «Il mio account».
      </p>
    );
  }
  return (
    <>
      <p className="mt-1 text-[15px] text-muted">Scrivi l&apos;email con cui accedi: ti mandiamo un collegamento per scegliere una nuova password.</p>
      <Form action={requestPasswordReset} className="mt-6 space-y-4">
        <Field name="email" label="Email" type="email" autoComplete="username" required />
        <FormMessage />
        <Submit className="w-full">Invia il collegamento</Submit>
      </Form>
    </>
  );
}

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Password dimenticata</h1>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
      <p className="mt-6 text-sm text-muted">
        <Link href="/login" className="link">
          Torna all&apos;accesso
        </Link>
      </p>
    </>
  );
}
