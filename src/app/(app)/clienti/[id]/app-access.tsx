import { and, asc, eq } from "drizzle-orm";
import { MessageCircle, Printer } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { ActionButton, Field, Form, FormMessage, Submit } from "@/components/form";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { db } from "@/db";
import { ownerAccess, ownerInvites, users } from "@/db/schema";
import { formatDate, formatDateTime, todayRome } from "@/lib/dates";
import { INVITE_MAX_FAILED, activationUrl, canInvite, formatInviteCode, inviteMessage, whatsappUrl } from "@/lib/owner-access";
import { appBaseUrl } from "@/server/app-url";
import { cancelInviteAction, createInviteAction, renewInviteAction, revokeAccessAction } from "@/server/owner-access-actions";

type OwnerInfo = {
  id: string;
  type: "persona" | "azienda";
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  fiscalCode: string | null;
  vatNumber: string | null;
  phone: string | null;
};

/** Scheda cliente → «Accesso all'app»: chi entra nell'area diportista, inviti in attesa, nuovo invito. */
export async function AppAccessCard({ marinaId, marinaName, owner }: { marinaId: string; marinaName: string; owner: OwnerInfo }) {
  const [accessRows, inviteRows, baseUrl] = await Promise.all([
    db
      .select({
        id: ownerAccess.id,
        name: users.name,
        email: users.email,
        createdAt: ownerAccess.createdAt,
        lastSeenAt: ownerAccess.lastSeenAt,
        revokedAt: ownerAccess.revokedAt,
      })
      .from(ownerAccess)
      .innerJoin(users, eq(users.id, ownerAccess.userId))
      .where(and(eq(ownerAccess.ownerId, owner.id), eq(ownerAccess.marinaId, marinaId)))
      .orderBy(asc(ownerAccess.createdAt)),
    db
      .select()
      .from(ownerInvites)
      .where(and(eq(ownerInvites.ownerId, owner.id), eq(ownerInvites.marinaId, marinaId)))
      .orderBy(asc(ownerInvites.createdAt)),
    appBaseUrl(),
  ]);
  const active = accessRows.filter((a) => !a.revokedAt);
  const revoked = accessRows.filter((a) => a.revokedAt);
  const now = new Date();
  const defaultName = owner.type === "persona" ? [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.displayName : "";

  return (
    <Card title="Accesso all'app">
      <p className="text-sm text-muted">
        Le persone invitate entrano nell&apos;area diportista di questo cliente: titolare, familiari, skipper.
      </p>

      {active.length > 0 && (
        <ul className="mt-4 space-y-3">
          {active.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                <p className="truncate text-xs text-muted">{a.email}</p>
                <p className="text-xs text-muted">
                  Attivo dal {formatDate(todayRome(a.createdAt))}
                  {a.lastSeenAt ? ` · ultimo ingresso ${formatDateTime(a.lastSeenAt)}` : " · mai entrato"}
                </p>
              </div>
              <ActionButton
                action={revokeAccessAction}
                fields={{ accessId: a.id, ownerId: owner.id }}
                size="sm"
                variant="ghost"
                confirm={`Togliere l'accesso a ${a.name}? Se è dentro l'app, ne esce subito.`}
              >
                Revoca
              </ActionButton>
            </li>
          ))}
        </ul>
      )}

      {inviteRows.length > 0 && (
        <ul className="mt-4 space-y-4 border-t border-line-soft pt-4">
          {inviteRows.map((inv) => {
            const expired = inv.expiresAt <= now;
            const blocked = inv.failedAttempts >= INVITE_MAX_FAILED;
            const expiresOn = formatDate(todayRome(inv.expiresAt));
            const url = activationUrl(baseUrl, inv.code);
            const message = inviteMessage({ personName: inv.name, marinaName, url, code: inv.code, expiresOn, company: owner.type === "azienda" });
            return (
              <li key={inv.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">Invito per {inv.name}</p>
                    <p className="font-mono text-lg tracking-wider text-ink">{formatInviteCode(inv.code)}</p>
                  </div>
                  {expired ? <Badge tone="bad">Scaduto</Badge> : blocked ? <Badge tone="bad">Bloccato</Badge> : <Badge tone="warn">In attesa</Badge>}
                </div>
                <p className="text-xs text-muted">
                  {expired ? `Scaduto il ${expiresOn}` : `Vale fino al ${expiresOn}`}
                  {blocked ? " · troppi tentativi con il codice fiscale sbagliato" : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!expired && !blocked && (
                    <>
                      <ButtonLink href={`/clienti/${owner.id}/invito/${inv.id}`} size="sm">
                        <Printer size={14} aria-hidden="true" />
                        Foglio di benvenuto
                      </ButtonLink>
                      <CopyButton text={message} label="Copia messaggio" />
                      <a href={whatsappUrl(owner.phone, message)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                        <MessageCircle size={14} aria-hidden="true" />
                        WhatsApp
                      </a>
                    </>
                  )}
                  <ActionButton action={renewInviteAction} fields={{ inviteId: inv.id, ownerId: owner.id }} size="sm" confirm="Creare un codice nuovo? Quello attuale smette di valere.">
                    Nuovo codice
                  </ActionButton>
                  <ActionButton action={cancelInviteAction} fields={{ inviteId: inv.id, ownerId: owner.id }} size="sm" variant="ghost" confirm="Annullare l'invito?">
                    Annulla
                  </ActionButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 border-t border-line-soft pt-4">
        {canInvite(owner) ? (
          <details open={active.length === 0 && inviteRows.length === 0}>
            <summary className="link cursor-pointer text-sm">Invita una persona</summary>
            <Form action={createInviteAction} className="mt-3 space-y-3" resetOnSuccess>
              <input type="hidden" name="ownerId" value={owner.id} />
              <Field name="name" label="Nome e cognome" defaultValue={defaultName} required hint="Il titolare, oppure un familiare o lo skipper." />
              <FormMessage />
              <Submit size="sm">Crea l&apos;invito</Submit>
            </Form>
          </details>
        ) : (
          <p className="text-sm text-muted">
            Per invitare qualcuno serve il <strong className="text-ink">codice fiscale o la partita IVA</strong> nella scheda del cliente: è la prova che
            chiediamo a chi attiva l&apos;accesso.
          </p>
        )}
      </div>

      {revoked.length > 0 && (
        <details className="mt-4 border-t border-line-soft pt-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">Accessi revocati ({revoked.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {revoked.map((a) => (
              <li key={a.id}>
                {a.name} · {a.email} · revocato il {formatDateTime(a.revokedAt)}
              </li>
            ))}
          </ul>
          <p className="hint">Per ridare l&apos;accesso, crea un nuovo invito: la persona lo attiva con la stessa email.</p>
        </details>
      )}
    </Card>
  );
}
