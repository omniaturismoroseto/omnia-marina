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
          "«Impostazioni» → «Pontili e posti»: crea pontili e banchine, poi «Aggiungi posti» in serie (es. da A1 ad A20) con categoria e misure.",
          "«Tariffe»: crea il listino dell'anno con i prezzi per categoria, le stagioni, i servizi e le cauzioni.",
          "«Impostazioni» → «Utenti»: aggiungi chi lavora in porto, con il ruolo giusto e una password provvisoria.",
          "«Clienti» → «Importa da Excel»: carica l'elenco dei clienti e delle barche che avete già. Poi crea i contratti.",
        ],
      },
    ],
    tips: [
      "La «Pianta dal vero» (foto aerea con i posti disegnati sopra) è facoltativa: la mappa funziona anche con lo schema dei pontili.",
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
          "Cambia la data in alto per vedere il porto in un altro giorno (per esempio a ferragosto).",
          "Se è stata caricata la pianta dal vero, «Schema» disegna il porto com'è davvero: pontili e banchine in grigio e su ogni posto la barca che lo occupa, lunga e larga quanto la barca vera, con la poppa verso il pontile. I posti liberi sono verdi e vuoti; le barche tratteggiate sono attese o fuori in mare. Il codice del posto è scritto lungo il posto; il nome del pontile compare nel riquadro del posto quando lo tocchi.",
          "Lo schema mostra anche terra, edifici, aree verdi e i servizi del porto (bar, ristorante, parcheggio, cantiere, carburante…) con le loro icone; sotto la mappa c'è l'elenco dei servizi. Si preparano in «Impostazioni» → «Pianta dal vero» → «Sfondo e servizi della mappa».",
          "«Foto dal vero» mostra le stesse barche e i servizi sopra la foto aerea.",
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
          "In «Altri spazi e spese» aggiungi spazio a terra, posti auto, carrello, spese fisse e i servizi o le cauzioni del listino. Accanto alle date, la casella «Annuale» copre fino al 31 dicembre.",
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
          "«Porto» → «Area diportisti e allerte»: orari dell'ufficio e informazioni utili che i diportisti vedono nell'app, posizione del porto (da Google Maps) per capire se burrasca e mare agitato lo riguardano, zona di allerta della Protezione Civile (trovata dal Comune, oppure scelta a mano) e, se volete, l'invio automatico dell'avviso.",
          "«Pontili e posti»: pontili, banchine e posti. In alto il riepilogo di oggi per pontile (posti, occupati, liberi, non disponibili, contratti attivi); in ogni scheda i posti per categoria. Tocca un posto per cambiarne misure, categoria o stato (in servizio, in manutenzione, fuori servizio).",
          "Per cambiare più posti insieme tocca «Scegli più posti», seleziona i posti (o «Tutti») e scegli solo ciò che cambia: categoria (anche con le sue misure), stato, misure, fondale, acqua e corrente. Da lì puoi anche eliminarli: quelli con contratti restano e vanno messi fuori servizio.",
          "Le frecce accanto al nome del pontile lo spostano in su o in giù: è l'ordine della mappa, degli elenchi e delle tariffe.",
          "Se dai a un pontile il nome di uno che esiste già, l'app lo segnala e chiede che cosa fare: unirli (i posti passano al pontile scelto con codici, misure e contratti) o tenerli separati. Anche i pontili con lo stesso nome creati in momenti diversi (per esempio dal riconoscimento automatico) compaiono in un avviso con «Unisci in …». Tienili separati se sulla pianta sono tratti ad angolo: nello schema un pontile è una striscia sola.",
          "«Pianta dal vero»: carica la foto aerea, imposta la scala misurando una distanza nota, poi disponi i posti tracciando ogni pontile dalla radice alla testata: la linea serve anche a disegnare il pontile nello schema della mappa. «Riconoscimento automatico» propone pontili e banchine dalla foto.",
          "Per ritoccare la pianta usa «Seleziona» e scegli «Sposta: pontile intero» o «posto singolo»: con «pontile intero» trascinando un posto si sposta tutto il suo pontile (o la banchina) e i pulsanti di rotazione lo ruotano attorno al suo centro; con «posto singolo» si muove solo quel posto. Poi «Salva la pianta».",
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
        ],
      },
    ],
  },
];

export function guideFor(role: Role): GuideSection[] {
  return GUIDE.filter((s) => s.roles.includes(role));
}
