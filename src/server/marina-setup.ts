import "server-only";
import type { Tx } from "@/db";
import { berthCategories, marinas, memberships, priceLists, seasonPeriods } from "@/db/schema";
import { CONTRACT_APPROVAL_TEMPLATE, CONTRACT_TERMS_TEMPLATE } from "@/lib/contract-texts";

export const PRIVACY_TEMPLATE = `INFORMATIVA SUL TRATTAMENTO DEI DATI PERSONALI
ai sensi degli artt. 13 e 14 del Regolamento (UE) 2016/679 (GDPR)

1. Titolare del trattamento
Il Titolare del trattamento è {{titolare}}, con sede in {{indirizzo}}, contattabile all'indirizzo {{email}}.

2. Dati trattati
Dati anagrafici e di contatto dell'intestatario del posto barca, estremi del documento di identità, codice fiscale e partita IVA, dati dell'unità da diporto (nome, matricola, dimensioni, assicurazione), dati relativi a contratti, addebiti e pagamenti.

3. Finalità e base giuridica
a) Stipula ed esecuzione del contratto di ormeggio e dei servizi portuali (art. 6.1.b GDPR).
b) Adempimento di obblighi di legge, inclusi quelli fiscali, contabili e di pubblica sicurezza (art. 6.1.c GDPR).
c) Sicurezza del porto e tutela dei diritti del Titolare (art. 6.1.f GDPR).
d) Invio di comunicazioni commerciali e promozionali, solo previo consenso (art. 6.1.a GDPR).
e) Comunicazione dei dati a cantieri e fornitori di assistenza indicati dall'interessato, solo previo consenso (art. 6.1.a GDPR).

4. Conservazione
I dati contrattuali e contabili sono conservati per dieci anni dalla cessazione del rapporto. I dati trattati sulla base del consenso sono conservati fino alla revoca.

5. Destinatari
I dati possono essere comunicati ad autorità marittime e di pubblica sicurezza, consulenti fiscali e fornitori di servizi informatici nominati responsabili del trattamento. I dati non sono diffusi.

6. Videosorveglianza
Le aree portuali sono videosorvegliate, come indicato dagli appositi cartelli, per la sicurezza delle persone, delle unità da diporto e della struttura (art. 6.1.f GDPR). Le immagini sono accessibili alla direzione del porto e al personale autorizzato, alle forze dell'ordine e all'autorità giudiziaria su loro richiesta e, tramite l'applicazione riservata del porto con credenziali personali, ai diportisti titolari di contratto al solo fine di controllare la propria unità. Le immagini non sono diffuse né pubblicate.

7. Diritti dell'interessato
L'interessato può chiedere in ogni momento l'accesso ai propri dati, la rettifica, la cancellazione, la limitazione, la portabilità, opporsi al trattamento e revocare i consensi prestati, scrivendo al Titolare. Ha inoltre diritto di proporre reclamo al Garante per la protezione dei dati personali.

8. Natura del conferimento
Il conferimento dei dati per le finalità a), b) e c) è necessario per la conclusione del contratto. Il consenso per le finalità d) ed e) è facoltativo.`;

const DEFAULT_CATEGORIES: [name: string, lengthCm: number, beamCm: number][] = [
  ["I · fino a 6,00 m", 600, 250],
  ["II · fino a 8,00 m", 800, 300],
  ["III · fino a 10,00 m", 1000, 350],
  ["IV · fino a 12,00 m", 1200, 400],
  ["V · fino a 15,00 m", 1500, 480],
  ["VI · fino a 18,00 m", 1800, 550],
];

// Crea un nuovo porto con l'utente indicato come direzione e i dati di partenza:
// categorie dimensionali, un listino dell'anno da compilare e i testi modello.
export async function createMarinaWithDefaults(tx: Tx, input: { name: string; userId: string; year: number }): Promise<string> {
  const [marina] = await tx
    .insert(marinas)
    .values({ name: input.name, privacyPolicyText: PRIVACY_TEMPLATE, contractTerms: CONTRACT_TERMS_TEMPLATE, contractApprovalText: CONTRACT_APPROVAL_TEMPLATE })
    .returning({ id: marinas.id });

  await tx.insert(memberships).values({ userId: input.userId, marinaId: marina.id, role: "admin" });

  await tx.insert(berthCategories).values(
    DEFAULT_CATEGORIES.map(([name, maxLengthCm, maxBeamCm], i) => ({ marinaId: marina.id, name, maxLengthCm, maxBeamCm, sortOrder: i })),
  );

  const [list] = await tx
    .insert(priceLists)
    .values({ marinaId: marina.id, name: `Listino ${input.year}`, validFrom: `${input.year}-01-01`, validTo: `${input.year}-12-31` })
    .returning({ id: priceLists.id });

  await tx.insert(seasonPeriods).values([
    { marinaId: marina.id, priceListId: list.id, season: "media", startDate: `${input.year}-06-01`, endDate: `${input.year}-06-30` },
    { marinaId: marina.id, priceListId: list.id, season: "alta", startDate: `${input.year}-07-01`, endDate: `${input.year}-08-31` },
    { marinaId: marina.id, priceListId: list.id, season: "media", startDate: `${input.year}-09-01`, endDate: `${input.year}-09-30` },
  ]);

  return marina.id;
}
