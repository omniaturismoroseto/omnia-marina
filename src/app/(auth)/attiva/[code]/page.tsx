import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivationPage } from "../activation-form";

export const metadata: Metadata = { title: "Attiva l'accesso" };

// Aperto dal QR code o dal collegamento del messaggio: il codice è già scritto.
async function Prefilled({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ActivationPage code={decodeURIComponent(code)} />;
}

export default function ActivateWithCodePage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<ActivationPage />}>
      <Prefilled params={params} />
    </Suspense>
  );
}
