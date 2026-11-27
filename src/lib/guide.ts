import type { Role } from "@/db/schema";

// Testi della Guida (/guida): poche istruzioni pratiche per sezione, mostrate secondo il ruolo.
// Nei testi i nomi di pulsanti, campi e pagine stanno tra «»: la pagina li mette in evidenza.
// Quando cambia un pulsante o un percorso dell'app, aggiornare anche qui.

export type GuideIcon = "start" | "dashboard" | "dock" | "map" | "owners" | "boats" | "contracts" | "messages" | "weather" | "accounting" | "tariffs" | "settings" | "account" | "help";

export interface GuideSection {
  id: string; // ancora: /guida#id
  title: string;
  icon: GuideIcon;
  roles: Role[];
  purpose: string; // a cosa serve, in una riga
  steps: { title: string; items: string[] }[];
  tips?: string[];
  link?: { href: string; label: string };
}

const ALL: Role[] = ["admin", "ufficio", "banchina"];
const OFFICE: Role[] = ["admin", "ufficio"];
const ADMIN: Role[] = ["admin"];

export const GUIDE: GuideSection[] = [
  {
    id: "primi-passi",
    title: "Primi passi: preparare il porto",
    icon: "start",
    roles: ADMIN,
    purpose: "L'ordine giusto per mettere in funzione l'app la prima volta. Ogni passo serve a quello dopo.",
    steps: [
      {
        title: "In quest'ordine",
        items: [
          "«Impostazioni» → «Porto»: dati della società, aliquota IVA abituale, logo della società di gestione, testi del contratto e dell'informativa privacy.",
          "«Impostazioni» → «Categorie»: le classi dei posti per misura (es. fino a 8 m, fino a 10 m…). A ogni categoria corrisponde una riga di prezzi.",
          "«Impostazioni» → «Pontili e posti»: crea pontili e banchine, poi «Aggiungi posti» in serie (es. da A1 ad A20: i numeri da 1 a 9 non hanno lo zero davanti) con categoria e misure. Se il pontile è già disegnato sulla pianta, i posti aggiunti dopo ci si dispongono da soli in coda agli altri, sul loro lato.",
          "«Tariffe»: crea il listino dell'anno con i prezzi per categoria, le stagioni, i servizi e le cauzioni.",
          "«Impostazioni» → «Utenti»: aggiungi chi lavora in porto, con il ruolo giusto e una password provvisoria.",
          "«Clienti» → «Importa da Excel»: carica l'elenco dei clienti e delle barche che avete già. Poi crea i contratti.",
        ],
      },
    ],
    tips: [
      "La «Mappa del porto» (foto aerea o base disegnata con i posti sopra) è facoltativa: la mappa funziona anche con lo schema dei pontili.",
      "I testi di contratto e informativa sono modelli: falli controllare dal vostro consulente prima di usarli.",
      "Nell'informativa lascia una riga vuota tra un paragrafo e l'altro e inizia i titoli con il numero («6. Videosorveglianza»): in stampa vanno in grassetto e restano attaccati al loro testo.",
    ],
    link: { href: "/impostazioni", label: "Apri le impostazioni" },
  },
  {
    id: "cruscotto",
    title: "Cruscotto",
    icon: "dashboard",
    roles: OFFICE,
    purpose: "La situazione del porto a colpo d'occhio, ogni mattina.",
    steps: [
      {
        title: "Cosa guardare",
        items: [
          "In alto: posti occupati, movimenti attesi oggi e importi scaduti da incassare. Tocca un riquadro per aprire il dettaglio.",
          "«Da tenere d'occhio»: addebiti scaduti, contratti in bozza da attivare, contratti in scadenza, assicurazioni scadute, clienti senza informativa firmata, segnalazioni aperte, numeri di contratto rimasti liberi.",
          "«Banchina oggi», «Prossimi incassi» e «Occupazione per pontile» completano il quadro.",
        ],
      },
      {
        title: "Allerte meteo e mare",
        items: [
          "«Allerte meteo e mare»: dai bollettini ufficiali della Protezione Civile, burrasca, tempesta e mare agitato vicino al porto (oggi, domani, dopodomani) e la criticità idrogeologica e temporali della zona.",
          "Con burrasca, tempesta o mare agitato vicino al porto, o allerta arancione o rossa, compare la striscia rossa con «Avvisa i clienti»: apre il messaggio urgente già scritto. Controllalo e premi «Invia».",
          "Dopo l'invio il pulsante diventa «Manda un altro avviso» per 24 ore. Se la direzione ha scelto l'invio automatico, l'avviso parte da solo. Più dettagli nella voce «Allerte».",
        ],
      },
    ],
    tips: ["Quando una voce di «Da tenere d'occhio» è risolta, sparisce da sola."],
    link: { href: "/", label: "Apri il cruscotto" },
  },
  {
    id: "banchina",
    title: "Banchina",
    icon: "dock",
    roles: ALL,
    purpose: "La pagina per il telefono di chi lavora in banchina: arrivi, uscite, partenze e segnalazioni del giorno.",
    steps: [
      {
        title: "Arrivi e partenze",
        items: [
          "Quando arriva una barca attesa, tocca «Registra arrivo».",
          "Se esce per una giornata in mare, tocca «Uscita in mare»; al ritorno «Registra rientro». Il posto resta suo.",
          "L'ultimo giorno del contratto tocca «Registra partenza»: il contratto si chiude e il posto torna libero.",
          "Se la barca va via per sempre prima della scadenza usa «Partenza anticipata» (chiede conferma).",
        ],
      },
      {
        title: "Segnalazioni",
        items: [
          "«Nuova segnalazione»: scegli posto barca, tipo (manutenzione, servizio richiesto…) e priorità, e scrivi cosa succede.",
          "Quando è risolta, «Chiudi segnalazione», con una nota facoltativa su com'è andata.",
        ],
      },
    ],
    tips: [
      "«Saldo da regolare in ufficio» accanto a una barca: il cliente ha importi da pagare, mandalo in ufficio.",
      "Sul telefono puoi aggiungere l'app alla schermata Home dal menu del browser («Aggiungi a schermata Home»): si apre come un'app.",
    ],
    link: { href: "/banchina", label: "Apri la banchina" },
  },
  {
    id: "mappa",
    title: "Mappa dei posti barca",
    icon: "map",
    roles: ALL,
    purpose: "Ogni posto con il suo stato: libero, occupato, barca fuori, in arrivo, in partenza, oltre scadenza, non disponibile.",
    steps: [
      {
        title: "Come si usa",
        items: [
          "Tocca un posto per vedere barca, proprietario, telefono, contratto e prossime assegnazioni: sul computer il riquadro si apre sopra la mappa, a destra (si chiude con la X); sul telefono sotto la mappa.",
          "Per l'ufficio il riquadro si apre con la foto della barca (o la sagoma del suo tipo, se la foto manca), il proprietario con il pulsante verde per chiamarlo e il contratto con una barra che mostra quanto manca alla partenza. Per la banchina in alto c'è una fascia colorata con lo stato del posto, poi righe grandi da toccare col telefono e i pulsanti di arrivo e partenza.",
          "«Aggiungi foto», sull'immagine o sotto il nome della barca, carica la foto o la scatta col telefono: resta nella scheda della barca e si vede ogni volta che si apre il posto.",
          "Cambia la data in alto per vedere il porto in un altro giorno (per esempio a ferragosto).",
          "Se è stata caricata la pianta dal vero, «Schema» disegna il porto com'è davvero: pontili e banchine in grigio e su ogni posto la barca che lo occupa, lunga e larga quanto la barca vera, con la poppa verso il pontile. I posti liberi sono verdi e vuoti; le barche tratteggiate sono attese o fuori in mare. Il codice del posto è scritto lungo il posto; il nome del pontile compare nel riquadro del posto quando lo tocchi.",
          "Lo schema mostra anche terra, edifici, aree verdi e i servizi del porto (bar, ristorante, parcheggio, cantiere, carburante…) con le loro icone; sotto la mappa c'è l'elenco dei servizi. Si preparano in «Impostazioni» → «Mappa del porto» → «Sfondo e servizi della mappa».",
          "«Foto dal vero» mostra le stesse barche e i servizi sopra la foto aerea.",
          "I posti auto riservati (se messi sulla mappa in Impostazioni → Posti auto) compaiono come rettangoli grigi con il loro codice: chiari se liberi nel giorno mostrato, scuri se assegnati (al passaggio dicono a chi); bordo continuo = coperto, tratteggiato = scoperto. Sotto la mappa il conteggio dei liberi e degli assegnati.",
          "Trascina con il mouse o con un dito per spostarti; ingrandisci con la rotellina, allargando due dita o con un doppio clic. Quando sei ingrandito, il pulsante in basso a destra torna alla vista intera.",
          "Su un posto libero l'ufficio trova «Assegna il posto»: apre un contratto nuovo già con posto e data.",
        ],
      },
    ],
    tips: ["Un posto in manutenzione o fuori servizio si imposta da «Impostazioni» → «Pontili e posti», toccando il posto."],
    link: { href: "/mappa", label: "Apri la mappa" },
  },
  {
    id: "clienti",
    title: "Clienti",
    icon: "owners",
    roles: OFFICE,
    purpose: "L'anagrafica dei proprietari: dati, barche, contratti, estratto conto e privacy.",
    steps: [
      {
        title: "Inserire i clienti",
        items: [
          "Uno alla volta: «Nuovo cliente», persona fisica o azienda.",
          "Tutti insieme da un file Excel: «Importa da Excel». Vedi l'anteprima prima di salvare: doppioni uniti, clienti già presenti (si completano solo i campi vuoti), righe da correggere o escludere. Un'importazione si può annullare.",
        ],
      },
      {
        title: "Nella scheda del cliente",
        items: [
          "«Aggiungi barca» e «Nuovo contratto» partono già con il cliente scelto.",
          "Privacy: stampa l'informativa, falla firmare e registra i consensi nella scheda.",
          "«Estratto conto»: addebiti e incassi del cliente.",
          "Chi non ha più un contratto attivo si può spostare nella categoria «Ex cliente»: esce dall'elenco normale ma resta consultabile nella sua linguetta. Se torna con un nuovo contratto, esce da solo dalla categoria.",
        ],
      },
      {
        title: "Accesso all'app per il diportista",
        items: [
          "Nella scheda del cliente, riquadro «Accesso all'app» → «Invita una persona»: il titolare, un familiare o lo skipper. Serve il codice fiscale o la partita IVA nella scheda: è la prova che chiediamo a chi attiva.",
          "Nasce un codice di 8 caratteri, valido 30 giorni e una volta sola. Consegnalo con il «Foglio di benvenuto» (da stampare, con il QR code), con «Copia messaggio» o con «WhatsApp».",
          "La persona apre il collegamento o inquadra il QR, scrive il codice fiscale dell'intestatario (per le società la partita IVA), sceglie email e password e conferma l'email. Da lì entra dalla normale pagina di accesso e vede solo l'area del suo cliente, mai il gestionale.",
          "Nello stesso riquadro vedi chi ha l'accesso e quando è entrato l'ultima volta. «Revoca» lo toglie subito; «Nuovo codice» sostituisce un codice perso, scaduto o bloccato dopo troppi tentativi sbagliati.",
          "Al primo accesso il diportista legge l'informativa privacy del porto (quella di «Impostazioni» → «Porto») con la parte sull'uso dell'app e la accetta: la presa visione si registra da sola nella scheda del cliente, in forma digitale. Il passo dopo è «Attiva le notifiche»: con un tocco il telefono chiede il permesso; si può anche scegliere «Non ora» e attivarle più tardi da «Messaggi». Se cambi la versione dell'informativa, al prossimo accesso gliela richiediamo.",
          "Nell'app il diportista vede la foto della sua barca, se l'avete caricata (altrimenti la sagoma del tipo di barca); non può cambiarla.",
        ],
      },
    ],
    tips: [
      "Su richiesta del cliente: «Esportazione completa dei dati» oppure «Anonimizza i dati personali» (contratti e contabilità restano, ma non più riconducibili a lui).",
      "Il nome della categoria «Ex cliente» si cambia in «Impostazioni» → «Porto».",
    ],
    link: { href: "/clienti", label: "Apri i clienti" },
  },
  {
    id: "barche",
    title: "Barche",
    icon: "boats",
    roles: ALL,
    purpose: "Le unità da diporto, con misure, proprietario, assicurazione e posto assegnato.",
    steps: [
      {
        title: "Come si usa",
        items: [
          "Ogni barca appartiene a un cliente: si aggiunge dalla scheda del cliente («Aggiungi barca») o da «Barche» → «Nuova barca».",
          "Lunghezza fuori tutto e larghezza massima sono obbligatorie: servono a proporre solo i posti in cui la barca entra.",
          "Inserisci compagnia, polizza e scadenza dell'assicurazione: le scadenze compaiono nel cruscotto.",
          "La scheda della barca mostra contratto, posto e ultimi movimenti in banchina.",
          "In alto a destra c'è la foto della barca: «Aggiungi foto» la carica dal computer o la scatta col telefono, «Cambia foto» la sostituisce e «Togli la foto» la elimina. Senza foto si vede una sagoma del tipo di barca (vela, motore, gommone, catamarano). Le foto non si cercano in rete: si usano solo quelle caricate da voi.",
        ],
      },
    ],
    tips: ["Le misure si scrivono in metri, con la virgola (es. 9,50).", "L'operatore di banchina consulta le barche ma non le modifica."],
    link: { href: "/barche", label: "Apri le barche" },
  },
  {
    id: "contratti",
    title: "Contratti",
    icon: "contracts",
    roles: OFFICE,
    purpose: "Assegnare un posto a una barca per un periodo, con importo, rate e stampa del contratto.",
    steps: [
      {
        title: "Creare un contratto",
        items: [
          "«Nuovo contratto»: scegli cliente, barca, tipo (annuale, stagionale, mensile, transito) e date.",
          "Gli annuali vanno per anno solare e finiscono sempre il 31 dicembre; gli stagionali vanno dal 1° maggio al 30 settembre. I pulsanti «Anno …» e «Stagione …» compilano le date da soli, anche per l'anno successivo.",
          "L'app propone solo i posti liberi in cui la barca entra e calcola l'importo dal listino. L'importo resta modificabile.",
          "«Scegli dalla mappa» apre lo schema del porto: i posti liberi e adatti alla barca sono verdi, tocca quello che vuoi.",
          "Salvato, il contratto è una bozza: non ha numero e in stampa porta la scritta «BOZZA». Si modifica con «Modifica».",
          "In «Altri spazi e spese» aggiungi spazio a terra, posti auto, carrello, spese fisse e i servizi o le cauzioni del listino. Servizi e cauzioni del listino in vigore alla data di inizio compaiono subito come pulsanti (non serve scegliere prima la barca): toccane uno per aggiungerlo, con il suo prezzo, che puoi cambiare; quelli già aggiunti hanno la spunta. Se nessun listino copre la data di inizio, l'app lo dice. Accanto alle date, la casella «Annuale» copre fino al 31 dicembre.",
          "Posto auto: spuntando «Posto auto coperto» o «Posto auto scoperto» compare «Quale posto auto», con i posti del tipo giusto creati in Impostazioni → Posti auto. Si sceglie dall'elenco o con «Scegli dalla mappa»; quelli già assegnati a un altro contratto in quelle date (o fuori servizio) sono grigi e dicono di chi sono. Il codice del posto auto va nel contratto, che lo stampa. Lo stesso vale nella scheda del contratto, in «Aggiungi spazio o spesa». Se il porto non ha posti auto di quel tipo resta il numero scritto a mano. Un contratto in bozza non impegna il posto auto: all'attivazione l'app controlla che sia ancora libero.",
        ],
      },
      {
        title: "Attivare e stampare",
        items: [
          "«Attiva il contratto»: scegli il numero di rate, la scadenza della prima e la cadenza. Il contratto prende il numero e nascono gli addebiti nello scadenziario.",
          "«Stampa» apre il contratto pronto da firmare; per avere il file scegli «Salva come PDF» nella finestra di stampa. Poi segna la data in «Firmato il».",
          "In cima al contratto stampato il riquadro «In sintesi» riassume posto, barca, periodo, scadenza dell'assicurazione, importi e rate: i dati arrivano dalle schede, quindi se lì manca qualcosa compare «—».",
        ],
      },
      {
        title: "Correggere o chiudere",
        items: [
          "Errore su un contratto attivo: «Torna in bozza», correggi e riattiva. Il numero liberato viene segnalato e lo riprende il primo contratto attivato.",
          "«Annulla il contratto»: il posto torna libero e gli addebiti non incassati vengono annullati.",
          "Il contratto si chiude quando in banchina si registra la partenza della barca.",
        ],
      },
    ],
    tips: ["I numeri dei contratti sono progressivi per anno e senza buchi: per questo le bozze non hanno numero."],
    link: { href: "/contratti", label: "Apri i contratti" },
  },
  {
    id: "messaggi",
    title: "Messaggi",
    icon: "messages",
    roles: ALL,
    purpose: "Avvisi ai diportisti: arrivano nella loro area dell'app e come notifica sul telefono, se l'hanno attivata.",
    steps: [
      {
        title: "Scrivere",
        items: [
          "«Nuovo messaggio» → scegli a chi: tutti i clienti con contratto attivo, un pontile, un tipo di contratto (annuali, stagionali…), chi è in porto adesso, oppure un singolo cliente.",
          "L'operatore di banchina scrive a un pontile, a chi è in porto o a un cliente; a tutti scrivono direzione e ufficio.",
          "Tipo: «Informazione», «Lavori o disservizio» oppure «Urgente» (meteo, sicurezza). Gli urgenti restano in evidenza nell'app del cliente finché non li apre.",
          "Dalla scheda del cliente, riquadro «Accesso all'app» → «Scrivi un messaggio», il destinatario è già scelto.",
        ],
      },
      {
        title: "Chi l'ha letto",
        items: [
          "Aprendo un messaggio vedi, cliente per cliente, chi l'ha letto e quando. Per gli urgenti non letti c'è il pulsante «Chiama».",
          "I clienti senza app attiva non ricevono niente subito: vedranno il messaggio quando attiveranno l'accesso.",
        ],
      },
    ],
    tips: ["Un messaggio inviato non si modifica: per una correzione mandane un altro allo stesso gruppo."],
    link: { href: "/messaggi", label: "Apri i messaggi" },
  },
  {
    id: "meteo",
    title: "Allerte",
    icon: "weather",
    roles: ALL,
    purpose: "Burrasca, mare agitato e criticità della zona dai bollettini della Protezione Civile, e l'avviso ai diportisti.",
    steps: [
      {
        title: "Cosa si vede",
        items: [
          "«Vento e mare»: dal bollettino di vigilanza meteorologica, per oggi, domani e dopodomani, i fenomeni previsti vicino al porto (entro 70 km): venti forti, burrasca, tempesta, raffiche frequenti, mare molto mosso, agitato o grosso, moto ondoso in aumento. In rosso quelli per cui avvisare. Sotto ogni giorno c'è il testo nazionale su venti e mari.",
          "«Criticità idrogeologica e temporali»: dal bollettino di criticità, l'allerta (verde, gialla, arancione, rossa) per la zona di allerta del porto, oggi e domani.",
          "Lo stesso riquadro, più piccolo, è nel «Cruscotto» e nella «Banchina». I bollettini escono ogni giorno nel primo pomeriggio: la mattina si vede quello del giorno prima.",
          "Servono la posizione e il Comune del porto, in «Impostazioni» → «Porto».",
        ],
      },
      {
        title: "Mandare l'avviso",
        items: [
          "La striscia rossa compare con burrasca, tempesta o mare agitato vicino al porto, oppure con allerta arancione o rossa. Il pulsante apre il messaggio urgente già scritto: controllalo, cambia se vuoi i destinatari, e premi «Invia».",
          "Direzione e ufficio avvisano tutti i clienti con contratto attivo; l'operatore di banchina chi è in porto adesso, oppure un pontile.",
          "Dopo l'invio il pulsante diventa «Manda un altro avviso» per 24 ore, così si vede che l'avviso è già partito.",
        ],
      },
    ],
    tips: [
      "Per la navigazione fanno fede anche gli avvisi di burrasca e il meteomar dell'Aeronautica Militare e gli avvisi della Capitaneria; per le allerte, quella della Regione.",
      "Zona di allerta e invio automatico li sceglie la direzione in «Impostazioni» → «Porto».",
    ],
    link: { href: "/meteo", label: "Apri le allerte" },
  },
  {
    id: "contabilita",
    title: "Contabilità",
    icon: "accounting",
    roles: OFFICE,
    purpose: "Quanto devono i clienti, quanto è stato incassato e le entrate e uscite di cassa e banca. Non sostituisce la fatturazione elettronica.",
    steps: [
      {
        title: "Scadenziario e incassi",
        items: [
          "Le rate dei contratti compaiono da sole. Per altri importi (servizi, utenze…) usa «Nuovo addebito».",
          "Apri un addebito e premi «Registra incasso»: data, importo (anche parziale) e metodo di pagamento.",
          "Ogni incasso finisce da solo in prima nota: i contanti in cassa, tutto il resto in banca.",
          "Incasso sbagliato? «Storna» lo toglie anche dalla prima nota.",
        ],
      },
      {
        title: "Prima nota e riepilogo",
        items: [
          "«Prima nota»: entrate e uscite di cassa e banca mese per mese. «Registra movimento» per spese e altre entrate che non sono addebiti.",
          "Se tenevate la prima nota in Excel, importala con «Importa da Excel», con anteprima e annullamento.",
          "«Riepilogo»: l'anno mese per mese, con i crediti ancora da incassare.",
          "«Esporta CSV» salva scadenziario o prima nota in un file per il commercialista, che si apre con Excel.",
        ],
      },
    ],
    link: { href: "/contabilita", label: "Apri la contabilità" },
  },
  {
    id: "tariffe",
    title: "Tariffe",
    icon: "tariffs",
    roles: OFFICE,
    purpose: "I listini dei prezzi: servono a proporre l'importo dei contratti, che resta sempre modificabile.",
    steps: [
      {
        title: "Come si usa",
        items: [
          "Un listino ha un periodo di validità e i prezzi per ogni categoria di posto e tipo di contratto (annuale, stagionale, mensile, transito).",
          "In «Dati del listino» scegli l'aliquota e se i prezzi che scrivi sono «Senza IVA» (l'IVA si aggiunge) o «IVA inclusa». I contratti propongono sempre gli importi IVA compresa.",
          "Per ogni categoria: rifiuti e condominio, proposti come voci dei contratti annuali. Le colonne «IVA» e «Totale annuo» (annuale + rifiuti + condominio + IVA) si calcolano da sole.",
          "«Stagioni»: indica i periodi di media e alta stagione; i giorni che restano sono bassa stagione e compaiono nell'elenco da soli.",
          "Sopra la griglia c'è una scheda per la «Tariffa base» e una per ogni pontile o darsena: ogni pontile creato ha la sua. I pontili con lo stesso nome hanno una scheda sola e gli stessi prezzi.",
          "Nella scheda «Tariffa base» spunta i pontili a cui si applica (uno, alcuni o «Tutti»; nessuno = spenta). Gli altri usano i prezzi della loro scheda.",
          "Nella scheda di un pontile: «Usa i prezzi di …» o «Torna alla tariffa base», e «Copia i prezzi da» per riprendere la tariffa base o quella di un altro pontile. Le caselle lasciate vuote usano la tariffa base.",
          "«Servizi e cauzioni»: le voci a prezzo fisso da aggiungere ai contratti; le cauzioni senza IVA. Nel contratto compare il nome che scrivi; se il nome parla di posto auto, carrello o spazio a terra, il contratto chiede anche numero e periodo.",
          "«Simulatore»: prova quanto costa un posto per una barca e un periodo.",
        ],
      },
    ],
    tips: ["L'ufficio consulta le tariffe; le modifica solo la direzione."],
    link: { href: "/tariffe", label: "Apri le tariffe" },
  },
  {
    id: "impostazioni",
    title: "Impostazioni",
    icon: "settings",
    roles: ADMIN,
    purpose: "Dati del porto, struttura dei pontili, categorie, persone che lavorano in porto e registro delle operazioni.",
    steps: [
      {
        title: "Le linguette",
        items: [
          "«Porto»: dati della società, logo della società di gestione (compare nel menu e nelle stampe), spese di gestione e quota rifiuti, nome della categoria «Ex cliente», testi del contratto e dell'informativa.",
          "«Porto» → «Testo del contratto»: le parti fisse del contratto stampato si scrivono come servono al porto: titolo, apertura, paragrafo del Locatore, testi degli articoli 1, 2 e 3, «cede in locazione» e le scritte sotto le firme; si può anche togliere il riquadro «In sintesi». I dati di ogni contratto (cliente, barca, posto, date, importi, scadenze) li aggiunge l'app; nei testi i campi tra graffe, come {porto} o {iva}, si riempiono da soli (l'elenco è sotto ogni testo). «Torna al testo predefinito» rimette il modello. Le condizioni dall'articolo 4 e l'approvazione specifica sono nel riquadro «Privacy e condizioni di contratto». Le modifiche valgono alla prossima stampa di ogni contratto, anche di quelli già fatti.",
          "«Porto» → «Area diportisti e allerte»: orari dell'ufficio e informazioni utili che i diportisti vedono nell'app, posizione del porto (da Google Maps) per capire se burrasca e mare agitato lo riguardano, zona di allerta della Protezione Civile (trovata dal Comune, oppure scelta a mano) e, se volete, l'invio automatico dell'avviso.",
          "«Pontili e posti»: a sinistra l'elenco dei pontili e delle banchine, ognuno con la barra di oggi (occupati, liberi, non disponibili) e il totale del porto in cima; toccandone uno si apre la sua scheda (sul computer a fianco, sul telefono a tutta pagina, con «Pontili» per tornare). Nella scheda: numeri del pontile, posti per categoria e i posti colorati come sulla mappa, su due file (lato sinistro sopra, destro sotto). «Trova un posto» in alto apre il pontile ed evidenzia il posto cercato. Se manca qualcosa per partire, in cima compaiono i «Primi passi del porto».",
          "Nella scheda di ogni pontile i posti sono disegnati come in porto: sopra un lato e sotto l'altro, dalla radice alla testata. Se il porto ha la mappa, i posti sono divisi nei moduli riconosciuti sulla foto (le parti staccate del pontile o della banchina: «Modulo 1», «Modulo 2»…, con i loro codici); se un modulo è più lungo dello schermo va a capo, con i due lati sempre uno di fronte all'altro. I moduli si possono chiamare come si vuole (es. «Testata», «Lato bar»): accanto al nome tocca «Dai un nome» (o «Rinomina») e «Salva», il riquadro si chiude da solo; lasciando vuoto torna «Modulo N». I posti non ancora messi sulla mappa sono in fondo, in «Non ancora sulla pianta».",
          "«Mostra sulla mappa» (in alto nella scheda) apre sotto la mappa del porto già ingrandita sul pontile, con gli stessi comandi di «Mappa del porto»: sposti, ruoti, cambi ormeggio e disponi i posti lì, poi «Salva la pianta». I posti che tocchi sulla mappa (il pontile, il modulo o il posto singolo, secondo «Sposta») sono contornati in arancio anche nella scheda sopra, con i loro codici; se sono di un altro pontile, la scheda passa a quel pontile. Nei pontili in più tratti «Sulla mappa» accanto a un tratto inquadra solo quello e lo colora di giallo. Anche i posti scelti con «Scegli più posti» sono gialli sulla mappa aperta. Senza mappa del porto il pulsante è «Vedi sulla mappa» e apre la griglia dei pontili.",
          "Le azioni sui posti stanno nella barra in basso che compare con «Scegli più posti» (modifica, codici, numerazione, unisci, dividi, elimina): prima scegli i posti, poi l'azione. Nel menu «Modifica i posti» (o «Modifica il tratto») restano le azioni su tutto il tratto, che si usano meno: disposizione e, per i tratti, aggiungere posti, rinominare, rendere pontile a sé, togliere il tratto. «Numerazione» (nella barra, sui posti scelti: un tratto intero con «Tratto …», un modulo o una fila con «da… a…»): «Parti dall'altra estremità» fa partire i numeri dall'altra testata (il primo posto va dove c'era l'ultimo), «Scambia i lati» mette i posti di sinistra a destra e viceversa. Ogni posto tiene codice, misure e contratti: cambia dove sta, nella scheda e sulla mappa.",
          "Tocca un posto per aprire il suo pannello: chi lo occupa oggi (con «Apri il contratto», o «Nuovo contratto su questo posto» se è libero), codice, stato, categoria, misure, lato e note, senza lasciare la pagina. Per cambiare più posti insieme tocca «Scegli più posti», poi i posti (con Maiuscole premuto scegli tutti quelli tra due posti) o una scelta rapida: tutti, un lato, un tratto, una categoria, «da… a…». In basso compare la barra con «Modifica» (categoria, anche con le sue misure, stato, misure, fondale, acqua e corrente), «Codici», «Numerazione», «Unisci» (i posti scelti, anche di più moduli, diventano un modulo solo, oppure entrano in un modulo che c'è già; i moduli rimasti vuoti spariscono; se i posti sono in tratti diversi, «Riunisci e unisci» li mette prima in un tratto solo, con il nome che scegli, e i tratti rimasti vuoti spariscono), «Dividi» (i posti scelti diventano un tratto a sé) ed «Elimina» (i posti con contratti restano e vanno messi fuori servizio).",
          "Per cambiare la sigla a tutti i posti di un pontile: «Scegli più posti» → «Tutti» → «Codici», scrivi la nuova sigla e scegli «Mantieni i numeri» (CN7 → G7) oppure «Rinumera in fila» (in ordine di codice dal primo numero in poi, serve quando sigle diverse hanno gli stessi numeri, come CN1 e CS1). Contratti e pianta restano collegati ai posti. La sigla del pontile si cambia dal menu ⋯ → «Rinomina e sigla».",
          "Il codice di un posto con un contratto attivo (in corso o che deve ancora iniziare) non si può cambiare: il contratto riporta il codice del posto e i contratti attivi non si modificano. Nel pannello del posto il codice è bloccato e dice quale contratto lo tiene; in «Codici» compare l'avviso e nessun codice cambia finché quei posti sono tra i scelti. Per dare un nuovo codice: chiudi o annulla il contratto, cambia il codice e fai un nuovo contratto per quel posto.",
          "L'ordine dei pontili (mappa, elenchi, tariffe) si cambia trascinando la maniglia ⠿ delle righe, oppure dal menu ⋯ → «Sposta in su/in giù». Nel menu ⋯ ci sono anche «Unisci con un altro pontile…», «Tariffa del pontile» ed «Elimina il pontile» (per confermare si riscrive il nome). «+ Aggiungi posti» apre il modulo con l'anteprima dei codici che verranno creati: in rosso quelli che esistono già e verranno saltati.",
          "Se dai a un pontile il nome di uno che esiste già, l'app lo segnala e chiede che cosa fare: unirli (i posti passano al pontile scelto con codici, misure e contratti) o tenerli separati. Anche i pontili con lo stesso nome creati in momenti diversi (per esempio dal riconoscimento automatico) compaiono in un avviso con «Unisci in …». Sulla pianta i pontili uniti restano tratti separati, che si spostano e si tracciano da soli (vedi «Mappa del porto»).",
          "«Mappa del porto» ha in alto un menu con le sue parti: «Posti sulla foto» (l'editor), «Foto aerea», «Riconoscimento automatico», «Sfondo e servizi» e «Base disegnata»; si vede solo quella scelta e passando da una all'altra le modifiche non salvate restano.",
          "«Posti auto»: crea i posti auto riservati in blocco (sigla, dal numero al numero, coperti o scoperti, misure), toccane uno per cambiarne codice, tipo, misure, note o metterlo fuori servizio (o eliminarlo, se non è mai stato in un contratto). In «Sulla mappa» li disponi: «Posa sulla mappa» (un clic per posto), «Metti in fila» (scegli i posti, poi clicca inizio e fine della fila: si mettono uno accanto all'altro in ordine di codice, «Inverti il lato» se finiscono dalla parte sbagliata), «Allinea in fila» (raddrizza i posti scelti dove sono: stessa linea, stesso angolo, stessa distanza, in ordine di codice), «Lunghezza −5 m … +5 m» (allunga o accorcia la fila dei posti scelti cambiando lo spazio tra i posti), «Aggiungi un posto» (il posto con il codice successivo, stesso tipo e misure, in fondo alla fila scelta, senza ridisegnarla) e «Togli l'ultimo» (o «Togli P…» con un posto solo scelto: lo elimina, se non è mai stato in un contratto), trascina per spostare (Maiuscole o Ctrl per sceglierne più d'uno), ruota, «Togli dalla mappa»; poi «Salva i posti auto». Sotto c'è la base disegnata (o lo schema) con i posti barca in trasparenza; «Foto dal vero» si sceglie.",
          "«Mappa del porto»: carica la foto aerea, imposta la scala misurando una distanza nota, poi disponi i posti tracciando ogni pontile dalla radice alla testata: la linea serve anche a disegnare il pontile nello schema della mappa. In «Disponi un pontile» scegli l'ormeggio: «Di prua» (barche perpendicolari, con la poppa al pontile) o «All'inglese» (barche di fianco al pontile, una dietro l'altra); vale anche per «Nuovo pontile» e «Ridisegna con una linea». Un pontile già disposto cambia subito, senza ritracciarlo: scegli l'ormeggio in «Disponi un pontile» con quel pontile selezionato, oppure tocca un suo posto e usa «Ormeggio» nel riquadro a destra (vale anche per un modulo o per i posti scelti); all'inglese la linea si allunga verso la testata quanto serve perché le barche non si sovrappongano. «Allinea in fila», l'allungamento e i posti aggiunti dopo riconoscono da soli le file all'inglese. «Riconoscimento automatico» propone pontili e banchine dalla foto.",
          "«Nuovo pontile» (in alto, dopo «Disponi un pontile») disegna un pontile che non esiste ancora: clicca sulla foto la radice e la testata, poi a destra scegli sigla, nome, tipo (pontile o banchina), posti a sinistra e a destra e categoria; l'anteprima mostra i posti sulla foto. «Crea il pontile» lo crea con i posti già disposti lungo la linea (numerati dalla radice, prima il lato sinistro) e salva prima le modifiche in corso alla pianta.",
          "Per ritoccare la pianta usa «Seleziona» e scegli cosa spostare: «pontile o tratto» (tutto il pontile o la banchina), «modulo» (solo la parte staccata del pontile a cui appartiene il posto: i moduli si riconoscono da soli la prima volta e poi restano fissi, anche se li avvicini), «posti scelti» (tocchi tu i posti da muovere insieme; toccane uno già scelto per toglierlo) o «posto singolo». I moduli si riconoscono fila per fila: posti orientati allo stesso modo e affiancati, o uno di fronte all'altro sulla stessa passerella; due file vicine ma sfalsate sono moduli diversi. Per rimettere in ordine una fila storta: con «modulo» o «pontile o tratto» tocca un suo posto e usa «Allinea in fila» nel riquadro a destra; oppure «posti scelti», tocca i posti e usa «Allinea in fila» (li raddrizza dove sono: stessa linea, stesso angolo, stessa distanza, in ordine di codice), oppure «Ridisegna con una linea» (clicchi inizio e fine sulla foto e si rimettono lungo la linea; «Inverti il lato» se finiscono dalla parte sbagliata), oppure «Togli dalla pianta» per disporli di nuovo da «Da disporre». Se un modulo è stato riconosciuto male, con «modulo» tocca un suo posto e usa «Riconosci di nuovo i moduli», oppure scegli i posti con «posti scelti» e usa «Fai un modulo con questi posti»; poi salva. Se un pontile intero si è diviso in tanti moduli (per esempio dopo un cambio di ormeggio fatto prima di questa versione), con «pontile o tratto» tocca un suo posto e usa «Rimetti in un modulo solo». Cambiando ormeggio (di prua ↔ all'inglese) ogni posto resta nel suo modulo. Per separarle per sempre, salva la pianta e nel riquadro «Posti scelti» usa «Fai un tratto con questi posti»: da quel momento si spostano da sole anche con «pontile o tratto». Trascinando un posto si sposta ciò che hai scelto; i pulsanti di rotazione lo ruotano attorno al suo centro e «−5 m … +5 m» lo allungano o accorciano cambiando lo spazio tra i posti: ogni fila resta dritta e nello stesso ordine, e accorciando ci si ferma quando i posti si toccano. Per muoverti sulla foto trascinala; ingrandisci con la rotellina o due dita. Sul computer l'editor usa tutta la larghezza dello schermo. L'editor parte con la base disegnata sotto i posti (senza base, con lo schema ricavato dai posti, che segue le modifiche); con «Sotto: Foto dal vero» passi alla foto aerea, per esempio per controllare dove stanno davvero le barche. Poi «Salva la pianta».",
          "I pontili uniti in «Pontili e posti» restano sulla pianta divisi nei tratti di prima («Pontile G · tratto CN», «tratto CS»…): ogni tratto ha la sua linea e si sposta, ruota e traccia da solo, come un pontile. Nello schema della mappa ogni tratto è disegnato per conto suo.",
          "In «Pontili e posti» un pontile unito mostra i posti divisi per tratto; nel menu «Modifica il tratto» di ogni tratto: «Disposizione» (in ordine di codice dalla radice, alternati o tutti da un lato; sulla pianta lungo la linea del tratto), «Aggiungi posti», «Rinomina», «Rendi pontile a sé» (torna un pontile separato, con gli stessi prezzi) e «Togli il tratto»; accanto al menu, «Sulla mappa» apre la mappa sotto, inquadrata sul tratto. «Scegli più posti» → «Tratto X» sceglie tutti i posti di un tratto.",
          "I posti aggiunti da «Pontili e posti» a un pontile già disegnato non vanno disposti a mano: si mettono da soli dopo l'ultimo posto del loro lato, alla stessa distanza e con lo stesso orientamento (su un lato ancora vuoto, di fronte ai posti dell'altro lato). Nei pontili uniti vanno nel tratto con la stessa sigla. Se serve, ritoccali con «Seleziona».",
          "Per dividere un pontile in tratti a mano (per esempio un braccio a L, o un pontile unito prima che esistessero i tratti): in «Pontili e posti» → «Scegli più posti» scegli i posti e nella barra in basso usa «Dividi»: il pontile resta uno solo, con la stessa sigla, categoria e prezzi e gli stessi numeri dei posti, ma i posti scelti diventano un tratto che sulla mappa si sposta da solo (vale anche per un pontile mai unito). Poi nell'editor il tratto compare da solo nell'elenco e si traccia o si sposta come un pontile.",
          "«Sfondo e servizi della mappa»: «Terra e acqua dai colori della foto» ricava da solo moli, banchine e piazzali (se sbaglia, cambia la sensibilità); «Edifici e servizi con Claude» propone edifici, aree verdi e servizi visibili. Poi ritocca: «Terra» e «Togli terra» aggiungono o tolgono zone con un clic per vertice, «Edificio» e «Verde» disegnano forme, «Servizio» posa un segnaposto scelto dall'elenco (con un nome, se vuoi). Con «Seleziona» sposti vertici e servizi o li elimini. Infine «Salva lo sfondo».",
          "«Base disegnata della mappa»: per uno schema da mappa illustrata carica una base fatta da un grafico ricalcando la foto aerea (terra, moli, pontili, edifici, verde; niente barche, scritte o servizi, che aggiunge l'app). Va in PNG con la stessa inquadratura della foto, anche a risoluzione doppia. Con la base caricata lo schema usa quella e nell'editor restano solo i servizi, che la direzione sposta quando vuole.",
          "«Categorie»: le classi dei posti per misura.",
          "«Utenti»: aggiungi persone, cambia il ruolo, reimposta la password.",
          "«Registro»: chi ha creato, modificato, esportato o cancellato dati personali e contabili.",
        ],
      },
      {
        title: "I ruoli",
        items: [
          "Direzione: tutto, comprese impostazioni, tariffe e utenti.",
          "Ufficio: clienti, barche, contratti e contabilità.",
          "Operatore di banchina: mappa, arrivi e partenze, segnalazioni; vede solo nome e telefono del proprietario e nessun dato contabile.",
        ],
      },
    ],
    link: { href: "/impostazioni", label: "Apri le impostazioni" },
  },
  {
    id: "account",
    title: "Il mio account",
    icon: "account",
    roles: ALL,
    purpose: "Il tuo nome e la tua password.",
    steps: [
      {
        title: "Come si usa",
        items: [
          "Tocca il tuo nome in fondo al menu (sul telefono: «Altro» → «Il mio account»).",
          "Al primo accesso cambia la password provvisoria con una tua, di almeno 10 caratteri.",
          "Password dimenticata: nella pagina di accesso tocca «Password dimenticata?» e scrivi la tua email. Ti arriva un collegamento per sceglierne una nuova (guarda anche nella posta indesiderata). In alternativa la direzione può darti una password provvisoria da «Impostazioni» → «Utenti».",
        ],
      },
    ],
    tips: ["Chi lavora in più porti trova «Cambia porto» nel menu.", "Tocca l'occhio a destra del campo password per vedere quello che stai scrivendo; toccalo di nuovo per nasconderlo."],
    link: { href: "/account", label: "Apri il mio account" },
  },
  {
    id: "problemi",
    title: "Se qualcosa va storto",
    icon: "help",
    roles: ALL,
    purpose: "Le correzioni più comuni.",
    steps: [
      {
        title: "Casi frequenti",
        items: [
          "Ho registrato un'uscita in mare per sbaglio: registra subito il rientro (e viceversa).",
          "Ho registrato una partenza per sbaglio: la partenza chiude il contratto e non si annulla. Avvisa subito l'ufficio.",
          "Ho registrato un incasso sbagliato: apri l'addebito e premi «Storna», poi registralo di nuovo.",
          "Ho attivato un contratto con un errore: «Torna in bozza», correggi e riattiva.",
          "Una pagina mostra dati vecchi: ricarica la pagina.",
          "Non trovo una sezione nel menu: non è prevista per il tuo ruolo. Se ti serve, chiedi alla direzione di cambiarlo.",
          "Sul telefono Samsung l'app è scura o grigia: è Samsung Internet che, con il telefono in tema scuro, scurisce le pagine da solo (il sito non lo può impedire). In Samsung Internet tocca il menu ≡ in basso a destra e spegni «Modalità scura»; oppure menu ≡ → Impostazioni → Laboratori → attiva «Usa il tema scuro dei siti web». Poi chiudi e riapri l'app. All'apertura l'app mostra lo stesso avviso una volta.",
        ],
      },
    ],
  },
];

export function guideFor(role: Role): GuideSection[] {
  return GUIDE.filter((s) => s.roles.includes(role));
}
