# Gymbrain — requisiti e decisioni

Data: 11 ottobre 2026.

Questo documento raccoglie le decisioni della conversazione e distingue le scelte confermate dalle proposte ancora da definire. La prima implementazione Nuxt/Vue/Fastify e il database Supabase sono realizzati; stato di deploy e limiti correnti sono descritti in README.md. Le integrazioni del peso richiedono ancora configurazione OAuth.

## Obiettivo

Applicazione per pianificare periodi di allenamento e registrare sessioni di palestra e calisthenics, destinata inizialmente all'utente e a un piccolo gruppo di amici. Ogni persona ha un account e accede soltanto ai propri dati.

Interfaccia in italiano, responsive per PC e smartphone, con grafica contemporanea e registrazione delle serie comoda durante l'allenamento.

## Organizzazione degli allenamenti

Gerarchia: **mesociclo → schede → workout/giornate → esercizi prescritti → serie**.

- Un mesociclo contiene più schede; ogni scheda contiene più giornate ordinate.
- L'app suggerisce normalmente la giornata successiva, ma l'utente sceglie quella realmente svolta e può allenarsi fuori ordine.
- La sessione svolta è distinta dal modello di giornata: conserva le prescrizioni applicate, così modificare la scheda non riscrive lo storico.
- Da definire il comportamento della sequenza dopo giornate saltate, fuori ordine o sessioni interrotte, e la gestione di più schede attive.

## Catalogo, prescrizioni e note

Ogni utente crea esercizi con nome, descrizione, note generali ed eventuali video dimostrativi allegati. Sono previsti anche link video esterni per contenere l'uso dello storage.

Le note sono separate per contesto:

1. Note generali dell'esercizio.
2. Note della prescrizione nella specifica scheda.
3. Note dell'esecuzione nella sessione.

Esempio: panca piana con esecuzione esplosiva nella scheda di forza e controllata in quella di ipertrofia.

Registrare serie, ripetizioni target, eventuale TUT target in secondi, RPE/RIR target e percepiti, ripetizioni effettive, carichi e note. La struttura deve consentire target diversi per serie. RPE e RIR sono indipendenti; un dato assente è diverso da zero.

La scheda può suggerire esercizi sostitutivi. Una sostituzione effettiva conserva esercizio previsto, esercizio eseguito, serie e ripetizioni reali e riguarda soltanto quella sessione, senza modificare automaticamente la scheda.

## Calisthenics e peso corporeo

Distinguere peso corporeo della sessione, zavorra, carico esterno e assistenza tramite elastici.

Per gli elastici registrare banda e configurazione utilizzata; colore, produttore, quantità e resistenza nominale sono dettagli da rifinire. La resistenza nominale non deve essere sottratta dal peso corporeo come se fosse una misura precisa.

Ogni sessione conserva il proprio peso corporeo. Una nuova pesata non aggiorna retroattivamente le sessioni precedenti. Inserimento manuale del peso sempre disponibile.

## Piattaforma scelta

- **PWA con Nuxt, Vue e TypeScript**.
- Utilizzabile da browser su PC e smartphone e installabile sulla Home di iPhone tramite Safari.
- Nessuna distribuzione App Store/TestFlight o firma settimanale per la versione scelta.
- React Native, Expo e Tauri sono esclusi dallo stack attuale.
- Frontend compilato in file statici; configurazione proposta: `ssr: false`.
- Service worker per aprire l'interfaccia offline dopo il primo caricamento riuscito.

Il primo accesso e la registrazione richiedono connessione. Non si presume esecuzione continua o sincronizzazione garantita in background su iOS.

## Offline e sincronizzazione

Decisione: **IndexedDB sul dispositivo**, database remoto e coda persistente di sincronizzazione.

- Salvare localmente modifiche e operazioni pendenti in modo atomico.
- Conservare gli allenamenti dopo chiusura e riapertura dell'app.
- Sincronizzare all'apertura e al ritorno della connessione, con retry e prevenzione dei duplicati.
- Mostrare gli stati salvato sul dispositivo, in attesa, sincronizzato, errore o conflitto.
- Gestire modifiche concorrenti fra dispositivi senza sovrascrittura silenziosa.
- Separare cache e coda per account; gestire il logout con dati ancora da sincronizzare.
- Non bloccare il salvataggio delle serie per un trasferimento video fallito; disponibilità offline dei video solo dopo download.

Proposte tecniche da dettagliare: UUID client, operazioni idempotenti, versionamento server, cursori incrementali assegnati dal server e tombstone per le eliminazioni. La cache locale non protegge dalla cancellazione dei dati del browser o dalla perdita del dispositivo.

## Runtime e backend

Decisioni confermate:

- **Node.js LTS**, versione esatta da fissare all'avvio dell'implementazione.
- **Fastify**, con monolite modulare e moduli estraibili.
- Nessun Platformatic/Watt.
- Contratti HTTP espliciti e comunicazioni interne senza rete.

Soluzione proposta e accettata: client di modulo con trasporto locale basato su `inject()` di istanze Fastify indipendenti, sostituibile con HTTP reale. Definire timeout, gestione errori e propagazione dell'identità; verificare i contratti su entrambi i trasporti. Non presumere che ogni comportamento di rete sia riprodotto automaticamente dal trasporto locale.

Confini iniziali proposti:

| Modulo | Responsabilità |
| --- | --- |
| Training | Catalogo, mesocicli, schede, giornate e prescrizioni |
| Tracking | Sessioni, serie, sostituzioni e peso della sessione |
| Integrations | Collegamenti esterni, token e importazioni |
| API pubblica | Verifica identità, instradamento e composizione |

Ogni modulo possiede tabelle e migrazioni. Nessun accesso diretto ai repository o alle tabelle degli altri moduli. L'estrazione futura richiederà anche gestione dei dati, autenticazione tra servizi e gestione dei guasti distribuiti.

pnpm è stato proposto, ma non ancora confermato come package manager. Bun non è il runtime scelto.

## Database unico e isolamento utenti

**Un solo PostgreSQL condiviso su Supabase**, gestito dal proprietario del progetto. Tutti gli utenti usano questo stesso database.

Decisione aggiornata esplicitamente dall'utente il 11 ottobre 2026: **autorizzazione soltanto lato server Fastify**, senza policy RLS per i dati applicativi. Questa scelta sostituisce la proposta precedente di isolamento RLS.

- Il browser usa Supabase Auth per il login, ma non ha permessi sulle tabelle o sulle RPC dati.
- Fastify verifica il token e ricava l'utente; non accetta un proprietario dal payload o da header client.
- Tutte le letture sono filtrate per proprietario; le mutazioni ricevono l'identit? verificata dal backend.
- `SUPABASE_SECRET_KEY` resta soltanto sul server. La chiave pubblica nel frontend non concede accesso diretto ai dati.
- Storage privato, URL temporanei per upload/download autorizzati dal backend.
- Cache IndexedDB separata per account; ? una copia locale per l'offline, non un altro database cloud.
- Le migrazioni 001 e 002 registrano l'evoluzione: 002 revoca l'accesso client e applica lo stato finale scelto.

Login implementato con email/password, conferma e recupero password. Serve configurare SMTP per l'invio agli amici; non viene disabilitata la conferma email come scorciatoia.

## Integrazioni del peso

Richiesta originale: importare le pesate Withings, attualmente collegate a WHOOP.

La verifica preliminare ha rilevato che l'endpoint WHOOP del peso restituisce il valore di profilo, non uno storico giornaliero datato. La direzione proposta è **integrazione diretta Withings**, tramite OAuth, recupero delle misurazioni e deduplicazione.

L'integrazione richiede registrazione dell'app e credenziali del fornitore e non è ancora realizzata. Conservare provenienza e timestamp disponibili, senza inventare una data di misurazione. Token e segreti rimangono sul backend. Prevedere recupero incrementale delle misure perse mentre il server è sospeso, senza dipendere soltanto dai webhook.

## Hosting definitivo

**Render Free + Supabase Free**, con GitHub per repository e deploy automatici.

Un solo servizio Render esegue Fastify e serve la PWA Nuxt compilata tramite `@fastify/static`. Frontend e API condividono origine e deployment:

- `/`: PWA e asset.
- `/api/*`: API dei moduli.
- `/integrations/*`: callback delle integrazioni; percorsi esatti da definire.

Supabase ospita database unico, autenticazione e Storage privato. Si parte con gli indirizzi gratuiti dei provider. Cloudflare Pages, Northflank e le altre alternative discusse non fanno parte della scelta finale.

Limiti verificati durante la progettazione, da ricontrollare prima del deploy:

- Render Free sospende il servizio dopo 15 minuti senza traffico; il risveglio può richiedere circa un minuto. Anche il primo caricamento della PWA non in cache ne risente.
- Il filesystem Render è effimero: non conservarvi dati persistenti o video caricati.
- Supabase Free include 500 MB di database e 1 GB di file, oltre a quote di traffico; può sospendersi dopo una settimana d'inattività.
- Gratuità subordinata alle quote; nessuna promessa di servizio sempre disponibile.

## Identità visiva

Nome confermato: **Gymbrain**.

È stata generata una proposta di logo con cervello integrato in un bilanciere, fondo grafite, lime e azzurro. Palette e dettagli definitivi devono essere validati nella realizzazione dell'interfaccia. L'immagine generata non è ancora un kit di icone PWA o un logo vettoriale.

Percorso originale restituito dal generatore, da verificare dopo la reinstallazione di Codex:

`C:/Users/aless/.codex/generated_images/01a12c01-ca53-79e3-bb43-bf3903c25c5d/exec-bccdc7b0-2709-4e84-918a-78564dd96a2f.png`

## Punti aperti e verifiche

Da definire: metodo di login, package manager, versioni, comportamento della sequenza delle giornate, risoluzione dei conflitti, limiti video, dettagli degli elastici, configurazione OAuth e icone PWA.

Verifiche prioritarie dell'implementazione:

1. Creazione di mesocicli, più schede e giornate, con note diverse per lo stesso esercizio.
2. Sessione offline, chiusura e riapertura, sincronizzazione senza duplicati.
3. Sostituzione limitata alla singola sessione e storico invariato dopo modifica della scheda.
4. Isolamento fra account, incluse relazioni, allegati e cache.
5. Conflitti fra dispositivi e retry dopo risposta server persa.
6. Peso, zavorra e bande distinti; pesate importate deduplicate.

I precedenti tentativi di salvare `gymbrain-product-spec.md` erano falliti per il provisioning della sandbox Windows. Questo documento li sostituisce e incorpora le decisioni successive. La presenza di questo file non implica che il prodotto sia già implementato.

## Fonti consultate

- https://render.com/docs/free
- https://render.com/docs/your-first-deploy
- https://supabase.com/pricing
- https://supabase.com/docs/guides/auth/auth-smtp
- https://developer.whoop.com/api/
- https://developer.withings.com/developer-guide/v3/data-api/notifications/notification-content/
- https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios

Le condizioni dei fornitori possono cambiare: verificarle al momento dell'attivazione.


## Aggiornamento: Withings e varianti

- Integrazione diretta Withings per le pesate; WHOOP resta separato e non necessario per il peso.
- Una sola applicazione OAuth Gymbrain, consenso individuale degli utenti, credenziali solo backend, token cifrati nel database condiviso. Pesi importati con provenienza e timestamp, ultimo valore suggerito nelle nuove sessioni senza modificare lo storico.

- Modello definitivo del repertorio: tipologia corpo libero/pesi; varianti del movimento (es. HSPU / Deep), con nome e note create dall'utente.
- Nella scheda: esercizio, variante, kg di sovraccarico per corpo libero o carico per pesi, bande di assistenza selezionabili. Preset GORNATION UL 2-7, Light 5-15, Medium 10-30, Heavy 20-40 kg nominali; nessuna sottrazione fissa dal peso corporeo.
- Migrazione 004 con backup dei record esercizio, ID conservati, storico sessioni invariato; migrazione IndexedDB v2 compatibile con outbox immutabile.

- Aggiornamento PWA automatico all'apertura/ritorno online/in primo piano e con controllo ogni 60 secondi; ricaricamento differito durante allenamenti e moduli aperti, anche tra piu schede. Cache dati e coda offline preservate. Nessun requisito di aggiornamento in background su iOS.
