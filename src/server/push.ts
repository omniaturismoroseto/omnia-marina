import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { sendNotification, type PushSubscription } from "web-push";
import { db } from "@/db";
import { ownerAccess, pushSubscriptions } from "@/db/schema";

// Notifiche sul telefono (web push). Servono le chiavi VAPID: VAPID_PUBLIC_KEY (pubblica, la usa il browser) e
// VAPID_PRIVATE_KEY (segreta, in produzione da Secret Manager). Senza chiavi le notifiche sono spente e i messaggi
// restano comunque nell'area diportista.

export function pushEnabled(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

export function pushPublicKey(): string | null {
  return pushEnabled() ? process.env.VAPID_PUBLIC_KEY!.trim() : null;
}

function vapidSubject(): string {
  return process.env.VAPID_SUBJECT ?? process.env.APP_URL ?? "https://omnia-marina.app";
}

// Servizi di notifica dei browser (Chrome/Android, Firefox, Safari/iPhone, Edge). L'indirizzo dell'iscrizione arriva
// dal browser: se fosse un indirizzo qualsiasi, il server gli manderebbe richieste a ogni messaggio.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.port === "" && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

export type PushPayload ={ title: string; body: string; url: string; tag?: string; urgent?: boolean };

export async function saveSubscription(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/**
 * Invia la notifica a tutti i dispositivi delle persone con accesso ai clienti indicati. Gli errori non fermano
 * l'invio; le iscrizioni non più valide (dispositivo cambiato, notifiche tolte) si cancellano.
 */
export async function pushToOwners(marinaId: string, ownerIds: string[], payload: PushPayload): Promise<number> {
  if (!pushEnabled() || ownerIds.length === 0) return 0;
  const subs = await db
    .selectDistinct({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .innerJoin(ownerAccess, eq(ownerAccess.userId, pushSubscriptions.userId))
    .where(and(eq(ownerAccess.marinaId, marinaId), inArray(ownerAccess.ownerId, ownerIds), isNull(ownerAccess.revokedAt)));

  const body = JSON.stringify(payload);
  const options = {
    vapidDetails: { subject: vapidSubject(), publicKey: process.env.VAPID_PUBLIC_KEY!.trim(), privateKey: process.env.VAPID_PRIVATE_KEY!.trim() },
    TTL: payload.urgent ? 6 * 60 * 60 : 24 * 60 * 60,
    urgency: payload.urgent ? ("high" as const) : ("normal" as const),
  };
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      const subscription: PushSubscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await sendNotification(subscription, body, options);
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        else console.error("Notifica non inviata", status ?? error);
      }
    }),
  );
  return sent;
}
