import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MailCheck } from "lucide-react";

export const metadata: Metadata = { title: "Conferma la tua email" };

async function Message({ searchParams }: { searchParams: Promise<{ invio?: string }> }) {
  const { invio } = await searchParams;
  return invio === "no" ? (
    <p className="mt-2 text-[15px] text-muted">
      L&apos;accesso è attivo, ma non siamo riusciti a mandarti l&apos;email di conferma. Prova ad accedere: te la mandiamo di nuovo.
    </p>
  ) : (
    <p className="mt-2 text-[15px] text-muted">
      Ti abbiamo mandato un&apos;email con il collegamento per confermare l&apos;indirizzo. Aprila (guarda anche nella posta indesiderata), poi torna qui e
      accedi con email e password.
    </p>
  );
}

export default function ActivationDonePage({ searchParams }: { searchParams: Promise<{ invio?: string }> }) {
  return (
    <>
      <MailCheck size={40} className="text-sea" aria-hidden="true" />
      <h1 className="mt-3 font-display text-3xl font-semibold text-ink">Accesso attivato</h1>
      <Suspense fallback={null}>
        <Message searchParams={searchParams} />
      </Suspense>
      <Link href="/login" className="btn btn-primary mt-6 w-full">
        Vai all&apos;accesso
      </Link>
    </>
  );
}
