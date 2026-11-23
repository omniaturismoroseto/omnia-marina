import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ShieldAlert } from "@/components/icons";
import { NoticeText } from "@/components/notice-text";
import { page } from "@/components/page";
import { PushToggle } from "@/components/push-toggle";
import { ButtonLink } from "@/components/ui";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { APP_PRIVACY_TEXT } from "@/lib/app-privacy";
import { requireOwner } from "@/lib/context";
import { one, type SearchParams } from "@/lib/params";
import { fillTemplate } from "@/lib/templates";
import { pushPublicKey } from "@/server/push";
import { PrivacyForm } from "./privacy-form";

export const metadata: Metadata = { title: "Benvenuto" };

// Primo accesso all'area diportista: 1) informativa privacy del porto e dell'app da accettare; 2) notifiche, facoltative.
// Si torna qui anche quando il porto pubblica una nuova versione dell'informativa.
export default page(async function OwnerWelcomePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireOwner({ allowPrivacyPending: true });
  const step = one((await searchParams).passo) === "notifiche" ? "notifiche" : "privacy";
  if (step === "privacy" && !ctx.privacyPending && !ctx.preview) redirect("/diportista");
  if (step === "notifiche" && ctx.privacyPending) redirect("/diportista/benvenuto");

  // Senza le chiavi delle notifiche (VAPID) il secondo passo non serve: l'informativa è l'unico.
  const publicKey = pushPublicKey();
  const steps = publicKey ? 2 : 1;
  if (step === "notifiche") {
    if (!publicKey) redirect("/diportista");
    return (
      <>
        <p className="text-sm font-medium text-muted">Passo 2 di 2</p>
        <h1 className="mt-1 text-3xl font-bold text-ink">Attiva le notifiche</h1>
        <p className="mt-2 max-w-prose text-[15px] text-muted">
          Ti avvisiamo sul telefono quando {ctx.marinaName} ti scrive: allerte meteo, lavori in banchina, scadenze. Puoi spegnerle quando vuoi dalla pagina
          «Messaggi».
        </p>
        <div className="mt-6 max-w-md">
          {ctx.preview ? (
            <div className="space-y-4">
              <p className="card p-4 text-sm text-muted">In prova come diportista le notifiche non si attivano: qui il cliente vede il pulsante «Attiva le notifiche».</p>
              <ButtonLink href="/diportista" variant="primary" size="lg" className="w-full">
                Vai alla tua barca
              </ButtonLink>
            </div>
          ) : (
            <PushToggle publicKey={publicKey} continueHref="/diportista" />
          )}
        </div>
      </>
    );
  }

  const [marina] = await db.select().from(marinas).where(eq(marinas.id, ctx.marinaId));
  const portText = marina.privacyPolicyText ? fillTemplate(marina.privacyPolicyText, marina) : null;
  const appText = fillTemplate(APP_PRIVACY_TEXT, marina);
  return (
    <>
      {steps > 1 && <p className="text-sm font-medium text-muted">Passo 1 di {steps}</p>}
      <h1 className="mt-1 text-3xl font-bold text-ink">Benvenuto, {ctx.user.name.split(" ")[0]}</h1>
      <p className="mt-2 max-w-prose text-[15px] text-muted">
        Prima di entrare leggi come {ctx.marinaName} tratta i tuoi dati e come funziona l&apos;app. Lo chiediamo una volta sola, e di nuovo solo se
        l&apos;informativa cambia.
      </p>
      {ctx.preview && (
        <p className="mt-4 flex items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          <ShieldAlert size={18} aria-hidden="true" className="shrink-0" />
          Sei in prova: «Accetto» mostra il passo successivo ma non registra niente per il cliente.
        </p>
      )}
      <div className="card mt-6 max-h-[55vh] overflow-y-auto p-5 text-[14px] leading-relaxed text-ink" tabIndex={0} aria-label="Informativa privacy">
        {portText && (
          <div className="mb-6 border-b border-line-soft pb-6">
            <NoticeText text={portText} />
          </div>
        )}
        <NoticeText text={appText} />
      </div>
      <div className="mt-5">
        <PrivacyForm />
      </div>
    </>
  );
});
