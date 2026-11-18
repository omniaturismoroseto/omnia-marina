import Link from "next/link";
import { Field, Form, FormMessage, Submit } from "@/components/form";
import { formatInviteCode, normalizeInviteCode } from "@/lib/owner-access";
import { activateAction } from "@/server/owner-access-actions";

/** Modulo di attivazione dell'area diportista: codice ricevuto dal porto + seconda prova + email e password. */
export function ActivationPage({ code }: { code?: string }) {
  const normalized = code ? normalizeInviteCode(code) : null;
  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Attiva l&apos;accesso</h1>
      <p className="mt-1 text-[15px] text-muted">Area diportisti: usa il codice che ti ha dato il porto, con il foglio di benvenuto o in un messaggio.</p>
      <Form action={activateAction} className="mt-6 space-y-4">
        <Field
          name="code"
          label="Codice di attivazione"
          defaultValue={normalized ? formatInviteCode(normalized) : ""}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-EFGH"
          required
        />
        <Field
          name="taxId"
          label="Codice fiscale o partita IVA"
          hint="Quello dell'intestatario del contratto (per le società, la partita IVA)."
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
        <Field name="email" label="La tua email" type="email" autoComplete="username" required />
        <Field
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="Almeno 10 caratteri. Se questa email ha già un account Omnia Marina, scrivi la sua password."
          required
        />
        <FormMessage />
        <Submit className="w-full">Attiva</Submit>
      </Form>
      <p className="mt-6 text-sm text-muted">
        Hai già attivato l&apos;accesso?{" "}
        <Link href="/login" className="link">
          Accedi
        </Link>
      </p>
    </>
  );
}
