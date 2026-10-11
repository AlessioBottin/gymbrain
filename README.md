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
- PWA con cache dell’interfaccia, icone installabili, aggiornamento su richiesta e supporto a movimento ridotto.

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

La prima migrazione conserva la storia del cambiamento; lo stato finale richiede entrambe. Le RPC serializzano le scritture per utente/modulo, assegnano revisioni server e conservano ricevute per prevenire duplicazioni dopo interruzioni. Le eliminazioni usano tombstone. Le sessioni contengono snapshot, senza join che ne riscrivano il passato.

## Render e Supabase

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

## Limiti ancora aperti

- Importazione Withings/WHOOP non collegata: richiede registrazione OAuth del fornitore; il peso manuale è funzionante.
- Nessun download persistente dei video per riproduzione offline.
- Il backup JSON è esportabile; ripristino da backup non ancora esposto nella UI.
- Gestione amministrativa, inviti e statistiche avanzate fuori dal primo rilascio.
- Test iPhone fisico e invio email SMTP da completare sui servizi configurati.

La presenza dei file di deploy non dimostra un deploy riuscito: lo stato effettivo viene comunicato dopo i controlli cloud.
