// Informativa che il diportista accetta al primo accesso all'app: l'informativa del porto (Impostazioni → Porto)
// seguita da questa parte sull'uso dell'app. Funzioni pure, provate nei test.

/** Da cambiare quando cambia il testo qui sotto: chi ha accettato la versione precedente la rivede al prossimo accesso. */
export const APP_PRIVACY_VERSION = "1";

/** Segnaposto come nell'informativa del porto: {{titolare}}, {{email}}… (vedi `fillTemplate`). */
export const APP_PRIVACY_TEXT = `Uso dell'app Omnia Marina

1. Cosa trattiamo nell'app
L'area diportista è il servizio con cui {{titolare}} ti mostra posto barca, contratti, estratto conto e messaggi del porto. Per farla funzionare trattiamo: nome ed email del tuo accesso, per farti entrare e recuperare la password; data e ora degli accessi, per la sicurezza del servizio; se scegli di attivarle, i dati tecnici del dispositivo che servono a mandarti le notifiche.

2. Notifiche
Le notifiche ti avvisano quando il porto ti scrive. Sono facoltative: puoi attivarle o spegnerle in ogni momento dalla pagina «Messaggi» o dalle impostazioni del telefono.

3. Cookie
L'app usa solo cookie tecnici, indispensabili per tenerti collegato. Non usa cookie di profilazione né pubblicitari.

4. Chi tratta i dati
Il titolare resta {{titolare}}. Il fornitore dell'app e i suoi fornitori tecnici (server, invio delle email e delle notifiche) trattano i dati solo per conto del porto e per far funzionare il servizio.

5. I tuoi diritti
Puoi chiedere accesso, rettifica o cancellazione dei tuoi dati e la chiusura dell'accesso all'app scrivendo a {{email}}.`;

/** Versione completa accettata: quella dell'informativa del porto più quella della parte sull'app. */
export function appPrivacyVersion(marinaPolicyVersion: string): string {
  return `${marinaPolicyVersion}/app-${APP_PRIVACY_VERSION}`;
}

/** Vero se il diportista deve ancora accettare (o riaccettare, dopo un cambio di versione) l'informativa. */
export function privacyPending(acceptedVersion: string | null, marinaPolicyVersion: string): boolean {
  return acceptedVersion !== appPrivacyVersion(marinaPolicyVersion);
}
