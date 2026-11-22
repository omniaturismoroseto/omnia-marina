import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionButton, Field, Form, FormMessage, Submit } from "@/components/form";
import { requireUser } from "@/lib/context";
import { ROLE_LABEL } from "@/lib/labels";
import { createMarina, logout, selectMarina, selectOwnerArea } from "@/server/auth-actions";

export const metadata: Metadata = { title: "Scegli dove entrare" };

async function MarinaList() {
  const ctx = await requireUser();
  return (
    <>
      {ctx.accountManager && (
        <p className="mt-4 rounded-md bg-sea-soft px-3 py-2 text-sm text-sea">
          Account manager: entri in tutti i porti e scegli con quale ruolo provarli, anche come diportista. Nei porti non compari tra gli utenti, nel registro delle operazioni né accanto alle modifiche che fai.
        </p>
      )}
      {ctx.memberships.length === 0 && ctx.ownerAreas.length === 0 && !ctx.accountManager ? (
        <p className="mt-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          Il tuo account non è collegato a nessun porto. Se lavori in porto, chiedi alla direzione di aggiungerti agli utenti; se sei un diportista, chiedi al porto un codice di attivazione.
        </p>
      ) : ctx.memberships.length === 0 ? null : (
        <ul className="mt-5 space-y-2">
          {ctx.accountManager
            ? ctx.memberships.map((m) => (
                <li key={m.marinaId} className="card p-3">
                  <p className="truncate font-medium text-ink">{m.marinaName}</p>
                  <p className="text-xs text-muted">Entra come</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(["admin", "ufficio", "banchina"] as const).map((role) => (
                      <ActionButton key={role} action={selectMarina} fields={{ marinaId: m.marinaId, role }} variant={role === "admin" ? "primary" : "secondary"} size="sm">
                        {ROLE_LABEL[role]}
                      </ActionButton>
                    ))}
                    <Link href={`/porti/diportista?porto=${m.marinaId}`} className="btn btn-secondary btn-sm">
                      Diportista
                    </Link>
                  </div>
                </li>
              ))
            : ctx.memberships.map((m) => (
            <li key={m.marinaId} className="card flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{m.marinaName}</p>
                <p className="text-xs text-muted">{ROLE_LABEL[m.role]}</p>
              </div>
              <ActionButton action={selectMarina} fields={{ marinaId: m.marinaId }} variant="primary" size="sm">
                Entra
              </ActionButton>
            </li>
          ))}
        </ul>
      )}

      {ctx.ownerAreas.length > 0 && (
        <>
          {ctx.memberships.length > 0 && <h2 className="mt-6 text-sm font-semibold tracking-wide text-muted uppercase">Area diportista</h2>}
          <ul className="mt-3 space-y-2">
            {ctx.ownerAreas.map((a) => (
              <li key={a.accessId} className="card flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{a.marinaName}</p>
                  <p className="truncate text-xs text-muted">Diportista · {a.ownerName}</p>
                </div>
                <ActionButton action={selectOwnerArea} fields={{ accessId: a.accessId }} variant="primary" size="sm">
                  Entra
                </ActionButton>
              </li>
            ))}
          </ul>
        </>
      )}

      {ctx.accountManager && (
        <details className="mt-6" open={ctx.memberships.length === 0}>
          <summary className="link cursor-pointer text-sm">Nuovo porto e il suo direttore</summary>
          <Form action={createMarina} className="mt-3 space-y-3" resetOnSuccess>
            <Field name="marinaName" label="Nome del porto" placeholder="Es. Marina di Levante" required />
            <Field name="directorName" label="Nome e cognome del direttore" required />
            <Field name="directorEmail" label="Email del direttore" type="email" required />
            <Field
              name="password"
              label="Password provvisoria"
              type="text"
              autoComplete="off"
              hint="Almeno 10 caratteri. Se l'email ha già un account non serve: il direttore entra con la password che già usa."
            />
            <FormMessage />
            <Submit variant="secondary">Crea il porto</Submit>
          </Form>
        </details>
      )}

      <form action={logout} className="mt-8">
        <p className="text-sm text-muted">
          Accesso come {ctx.user.email}.{" "}
          <button type="submit" className="link cursor-pointer">
            Esci
          </button>
        </p>
      </form>
    </>
  );
}

export default function MarinasPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Dove vuoi entrare?</h1>
      <p className="mt-1 text-[15px] text-muted">Il tuo account ha accesso a più porti o aree: scegli quella su cui lavorare.</p>
      <Suspense fallback={<p className="mt-5 text-sm text-muted">Caricamento…</p>}>
        <MarinaList />
      </Suspense>
    </>
  );
}
