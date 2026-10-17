# Gymbrain

PWA Nuxt/Vue per palestra e calisthenics. UI grafite/lime, navigazione animata e modalità allenamento immersiva. Un solo servizio Fastify serve frontend statico e API; un solo progetto Supabase contiene i dati di tutti gli utenti.

## Avvio

Requisiti: Node 24 LTS, npm.

```sh
npm ci
# Copiare .env.example in .env e compilare le tre variabili Supabase.
npm run dev
```

Web: `http://127.0.0.1:3000`. Fastify: `http://127.0.0.1:3001`.

```sh
npm run build
npm start
```

La build statica è servita su `http://127.0.0.1:3001`. `npm run ui` apre il prototipo HTML originale approvato. La modalità dimostrativa dell’app reale si abilita esplicitamente con `GYMBRAIN_LOCAL_DEMO=true` prima della build e resta separata dagli account; in produzione è disabilitata.

## Funzioni implementate

- Catalogo personale, descrizioni, note generali, link HTTPS e allegati video privati fino a 25 MB.
- Mesocicli, più schede per mesociclo, giornate ordinate, editor delle prescrizioni per serie e note contestuali.
- Sessioni persistenti, target separati da valori effettivi, RPE/RIR, ripetizioni, TUT, carico esterno, zavorra, banda e peso corporeo.
- Sostituzioni nella singola sessione con conservazione dell’esercizio previsto. Sostituire prima di registrare le serie, oppure riaprirle.
- Timer recupero, avanzamento suggerito dopo la giornata svolta, conclusione anche parziale con conferma, storico e backup JSON.
- Auth Supabase email/password, conferma account e recupero password.
- IndexedDB per account, outbox atomica e persistente, retry idempotente, versionamento ottimistico e scelta esplicita dei conflitti.
- PWA con cache dell’interfaccia, icone installabili, aggiornamento automatico quando non si sta modificando un modulo o registrando un allenamento, e supporto a movimento ridotto.

Primo accesso online richiesto. La sincronizzazione viene tentata all’apertura, al ritorno online e ogni 30 secondi mentre l’app è aperta. Nessuna promessa di esecuzione in background su iOS. Video e primo caricamento richiedono rete. Una cancellazione dei dati del browser elimina la cache e le modifiche non ancora sincronizzate.

## Database unico e autorizzazione server

**Decisione aggiornata dell’utente:** autorizzazione per utente in Fastify, senza policy RLS per i dati applicativi. Il browser non ha grant sulle tabelle o sulle funzioni di scrittura: non basta conoscere la chiave pubblica per accedere ai dati.

- Fastify verifica il token con Supabase Auth; ignora identificativi proprietario e header arbitrari inviati dal client.
- Ogni lettura usa `user_id` derivato dal token. Le RPC ricevono l’identità dal server, mai dal payload del client.
- `SUPABASE_SECRET_KEY` è esclusivamente server-side e non compare nel bundle Nuxt.
- Il bucket video resta privato. Fastify autorizza e firma URL brevi; il browser trasferisce il file con il token firmato.
- Training e Tracking possiedono tabelle separate nello stesso database. Media gestisce i link firmati.
- I moduli sono istanze Fastify indipendenti, raggiunte tramite `inject()`; il trasporto HTTP equivalente è incluso e testato. Nessun Platformatic.

Applicare le migrazioni **una sola volta, in ordine** nel SQL Editor di Supabase:

1. `supabase/migrations/202610110001_core.sql`: schema iniziale.
2. `supabase/migrations/202610110002_server_authorization.sql`: decisione aggiornata, revoca accesso client e sposta autorizzazione al backend.
3. `supabase/migrations/202610110003_withings.sql`: integrazione Withings, token cifrati, stati OAuth, lock e importazione idempotente nel modulo Tracking.
4. `supabase/migrations/202610110004_exercise_variants.sql`: catalogo con tipologia corpo libero/pesi e varianti del movimento; backup e migrazione dei record esistenti, senza cambiare ID o snapshot delle sessioni.

La prima migrazione conserva la storia del cambiamento; lo stato finale richiede tutte le migrazioni elencate, in ordine. Le RPC serializzano le scritture per utente/modulo, assegnano revisioni server e conservano ricevute per prevenire duplicazioni dopo interruzioni. Le eliminazioni usano tombstone. Le sessioni contengono snapshot, senza join che ne riscrivano il passato.

## Render e Supabase

App pubblicata: **https://gymbrain-llkm.onrender.com**. Deploy iniziale `5b7fc47` su `main`, Free / Frankfurt. Verificati il 11 ottobre 2026: homepage e health check (`ok: true`, `configured: true`), login reale, scrittura sul database, modifica offline e sincronizzazione alla riconnessione. Site URL e redirect Supabase Auth configurati per questa origine HTTPS. SMTP Brevo configurato; consegna email reale ancora da verificare.

`render.yaml` definisce un servizio Node **Free** a Francoforte. Collegare il repository GitHub, impostare `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` nel servizio. Build e frontend usano solo URL e chiave pubblica; la secret key resta nel processo Fastify.

Impostare in Supabase Auth il Site URL e i Redirect URL all’indirizzo HTTPS Render finale. Per conferma email e recupero password degli amici serve un SMTP configurato; il servizio email predefinito Supabase non è un servizio di invio generico per utenti esterni al team. Non disabilitare la conferma email come scorciatoia.

Render Free può sospendersi per inattività: la coda locale conserva le modifiche e il client attende fino a 75 secondi per il risveglio. Nessun file persistente viene scritto sul filesystem Render. Le quote dei piani gratuiti si applicano.

## Verifica

```sh
npm test
npm run typecheck
npx tsc -p tsconfig.server.json
# Compilare con GYMBRAIN_LOCAL_DEMO=true per i test UI locali.
npm run build
npm run test:e2e
```

Test Node: contratti `inject`/HTTP, isolamento nel gateway, assegnazione server del proprietario, PostgreSQL locale via PGlite (migrazioni, grant, gerarchia, idempotenza, conflitti), IndexedDB e snapshot. Test Playwright su Chrome: desktop/mobile, sessione recuperata dopo reload offline, sostituzioni, editor scheda, creazione esercizi e overflow mobile. Test browser su contesti isolati, senza utilizzare il profilo personale Chrome.

Il controllo cloud facoltativo `scripts/live-smoke.ts` richiede `RUN_LIVE_TESTS=yes` e `.env`: crea due account temporanei marcati (senza inviare email), verifica le API reali e li elimina con i soli dati del test. Anche `tests/e2e/live.spec.ts` richiede l'opt-in; verifica nel browser login reale, sincronizzazione, ricaricamento offline con sessione scaduta e invio delle modifiche al ritorno online.

Il deploy rimuove le dipendenze di sviluppo dopo la build. Audit delle dipendenze di produzione: nessuna vulnerabilità rilevata alla verifica del 11 ottobre 2026. Restano advisory nelle dipendenze degli strumenti di build Nuxt; non vengono incluse nel processo Fastify distribuito.

## Limiti ancora aperti

- Integrazione Withings implementata; il test delle pesate reali richiede configurazione server e consenso OAuth dell'utente. WHOOP non integrato.
- Nessun download persistente dei video per riproduzione offline.
- Il backup JSON è esportabile; ripristino da backup non ancora esposto nella UI.
- Gestione amministrativa, inviti e statistiche avanzate fuori dal primo rilascio.
- Test iPhone fisico e invio email SMTP da completare sui servizi configurati.

La verifica browser in produzione utilizza account temporanei confermati tramite amministrazione, poi eliminati; non dimostra la consegna delle email di registrazione o recupero password.

## Withings

In Account, il pannello Withings permette di collegare l'account, aggiornare le pesate e scollegarlo.

Configurare una Public API application nel [portale Withings](https://developer.withings.com/dashboard/) con redirect OAuth esatto `https://gymbrain-llkm.onrender.com/api/withings/callback`. Scope richiesto: `user.metrics`. Impostare su Render (solo backend):

- `APP_ORIGIN=https://gymbrain-llkm.onrender.com`
- `WITHINGS_CLIENT_ID` e `WITHINGS_CLIENT_SECRET` dell'applicazione.
- `WITHINGS_ENCRYPTION_KEY`: 32 byte casuali crittografici codificati in 64 caratteri esadecimali. Conservare la stessa chiave tra i deploy; cambiarla senza migrare i token richiede il ricollegamento degli utenti.

Senza configurazione il pannello mostra lo stato non attivo; il resto dell'app rimane utilizzabile. Applicare la migrazione 003 prima di abilitare le variabili. Le nuove tabelle sono accessibili solo dal server, senza policy RLS per utente, come il resto dell'architettura.

Il collegamento usa state monouso di 10 minuti, associato all'utente verificato e a un cookie Secure/HttpOnly/SameSite=Lax. Il gateway non registra codici, query OAuth o segreti webhook. Access/refresh token e segreto webhook vengono cifrati con AES-256-GCM e associati all'utente. Un lease PostgreSQL serializza collegamento, refresh, importazione e revoca; il nuovo refresh token viene salvato prima del primo utilizzo dell'access token.

`getmeas` importa solo peso, categoria misurazioni reali, con conversione `value * 10^unit`. Data UTC e ID Withings rimangono associati alla pesata. Storico paginato con checkpoint persistente, importazioni ripetibili e aggiornamenti senza duplicati; eventuali tombstone locali non vengono ripristinate. Le cancellazioni effettuate nella piattaforma Withings non sono attualmente propagate: getmeas viene usato per creazioni e aggiornamenti. Le sessioni concluse conservano il proprio snapshot.

Il modulo si iscrive alle notifiche peso (`appli=1`), con URL casuale per connessione e controllo dell'utente Withings. Le notifiche non forniscono pesi attendibili direttamente: il server recupera sempre i valori dalle API autorizzate. Un flag persistente registra le notifiche prima della risposta; l'importazione continua in background quando il processo e' attivo. Recupero anche all'apertura, al ritorno online, ogni cinque minuti con app visibile e su richiesta. Un batch elabora fino a cinque pagine; storici molto grandi proseguono nei batch successivi. Se Render sospende o riavvia il processo, il recupero riparte dai checkpoint alla prossima apertura/notifica: nessuna promessa di aggiornamento istantaneo.

Scollega revoca l'autorizzazione presso Withings, rimuove token/stati dal database e conserva le pesate gia' importate. Per completare il primo test reale, l'utente deve autorizzare il proprio account; i test automatici non sostituiscono quel consenso.

Riferimenti: [OAuth](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/oauth-web-flow/), [token](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/access-and-refresh-tokens-no-recover/), [API](https://developer.withings.com/api-reference/), [piani](https://static.withings.com/content/api/plans/plans.html). Alla verifica dell'11 ottobre 2026 il piano Free prevede 10 utenti, ampliabili dopo revisione; la pagina annuncia Withings+ per gli account Withings creati dopo il 12 ottobre 2026, con esenzione degli account precedenti.


## Repertorio, varianti e assistenza

Un esercizio nel repertorio contiene nome, descrizione, note, video, tipologia **corpo libero** o **pesi** e varianti del movimento create dall'utente (nome e note). Esempio: HSPU con variante Deep. Nella giornata della scheda si selezionano esercizio e variante; per corpo libero si impostano sovraccarico in kg e assistenza. Per gli esercizi con pesi si imposta il carico. I kg possono essere impostati su tutte le serie insieme o modificati serie per serie.

Preset di assistenza dal [set ufficiale GORNATION](https://www.gornation.com/products/premium-resistance-bands-set), verificati l'11 ottobre 2026:

| Banda | Range nominale |
| --- | --- |
| Ultra Light | 2-7 kg |
| Light | 5-15 kg |
| Medium | 10-30 kg |
| Heavy | 20-40 kg |

Si possono selezionare piu' bande e aggiungere note sulla configurazione. I range sono resistenze nominali, non sottrazioni costanti dal peso corporeo; nessun calcolo di carico netto automatico. Schede e sessioni conservano nome/note della variante e dettagli delle bande come snapshot, anche se il repertorio cambia.

Migrazione 004: `external` diventa `weights`; `bodyweight`, `weighted`, `band` diventano `bodyweight`. I record senza vecchia tipologia partono da corpo libero e sono modificabili. Le varianti iniziano vuote; non si deducono varianti dai nomi e non si uniscono esercizi esistenti automaticamente. Copia originale in `catalog_v2_backup`, privata e legata al ciclo di vita dell'account. Versioni/revisioni avanzano per aggiornare le cache; un vecchio salvataggio offline produce un conflitto risolvibile, senza sovrascrivere in silenzio la migrazione. Un trigger normalizza anche scritture legacy. IndexedDB v2 aggiorna cache e snapshot in memoria senza alterare payload o ID delle operazioni gia' in coda. I dati storici delle sessioni nel cloud non vengono riscritti.

## Aggiornamenti PWA

Il client registra il service worker generato da Workbox e verifica aggiornamenti all'avvio, al ritorno online/in primo piano e ogni 60 secondi mentre l'app è visibile. Un aggiornamento pronto viene applicato automaticamente dopo un intervallo inattivo, senza pulsante di conferma. Ogni scheda decide autonomamente quando ricaricarsi: allenamento, modali, campi in modifica, login da rinnovare e operazioni in corso rinviano il ricaricamento. Anche se un'altra scheda attiva la nuova versione, la scheda con una sessione aperta aspetta la chiusura. IndexedDB e la coda offline non vengono cancellati.

Il controllo richiede connessione e app aperta: su iOS non dipende da esecuzione in background. Un dispositivo che esegue ancora il vecchio client con aggiornamento manuale può richiedere una prima riapertura/"Aggiorna app"; da questa versione si applica il comportamento automatico.

`tests/e2e/updates.spec.ts` serve due revisioni degli artefatti di produzione con il vero service worker, verifica aggiornamento automatico tra due schede, rinvio durante l'allenamento, mantenimento della coda e recupero della sessione offline. La verifica su iPhone fisico resta da effettuare.


## Builder e volume muscolare

In Percorso, ogni mesociclo può contenere più schede. Le schede nuove richiedono inizio e fine del periodo; quelle precedenti restano leggibili e si possono completare con Modifica. Apri builder scheda per vedere tutte le giornate, aggiungere giorni della settimana o giornate personalizzate, selezionare più destinazioni per un esercizio e spostare esercizi tra le colonne. Il salvataggio locale di tutte le giornate e delle relative operazioni offline è atomico; la sincronizzazione remota continua per singolo record con i controlli di conflitto esistenti.

Nel catalogo, ogni utente definisce i propri coefficienti per muscolo da 0 a 1, a passi di 0,1. Le varianti ereditano i coefficienti non impostati; un override esplicito a 0 esclude quel muscolo. Petto incluso; deltoidi laterali e frontali costituiscono un unico gruppo, come nell'elenco richiesto. Nessun coefficiente fisiologico viene assegnato automaticamente agli esercizi esistenti.

Il volume è il numero di serie incluse moltiplicato per il coefficiente personale: non è tonnellaggio né una stima clinica. Una casella per serie permette di escludere il riscaldamento. Il builder usa il catalogo personale corrente e mostra il totale per giornata e per scheda, senza moltiplicarlo per settimane. La sessione conserva uno snapshot dei coefficienti al suo avvio. Le giornate si possono avviare singolarmente o in selezione multipla; ogni sessione aperta ha un comando Riprendi.

I campi sono opzionali nei record JSON per compatibilità con cache e sessioni precedenti. Non occorre una migrazione SQL; occorre distribuire insieme frontend e backend aggiornati prima di sincronizzare questi nuovi campi.


### Tecniche di intensità

Nel builder e nell'editor giornata, Gruppo di esecuzione crea un jump set o superset; gli altri esercizi si collegano allo stesso gruppo. L'ordine segue la giornata. Jump: recupero configurabile dopo ogni esercizio. Superset: nessuna pausa interna, recupero a fine giro. I giri seguono il numero di serie; se le quantità differiscono, gli esercizi terminati non partecipano ai giri rimanenti.

Ogni serie può essere standard, cluster o drop. Cluster e drop contengono da 2 a 10 passaggi con ripetizioni/secondi e kg; il cluster ha pause interne configurabili, il drop no e i suoi carichi non possono aumentare. I passaggi contano complessivamente come una serie equivalente, salvo esclusione esplicita dal volume. La sessione registra ogni passaggio separatamente, suggerisce il prossimo esercizio e applica i recuperi del gruppo. Nell'esecuzione sono combinabili gruppi di esercizi e tecniche della singola serie.
