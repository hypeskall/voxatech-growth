# Voxa Growth

Sistem intern de achiziție și vânzări VoxaTech. Next.js 16, TypeScript strict, App Router, Tailwind CSS, componente shadcn/ui bazate pe Radix și Supabase. Interfața și textele generate sunt în română.

Fluxul Gmail nou include conectarea mai multor căsuțe, Autopilot cu pornire/pauză, limite comune de 1–10 trimiteri pe zi per căsuță și Inbox pentru răspunsuri. Începe cu [ghidul de activare pas cu pas](ACTIVARE_PAS_CU_PAS.md); detalii în [configurarea Gmail](GMAIL_SETUP.md). Migrarea și programarea sunt aplicate; conectarea Google și publicarea versiunii actualizate necesită acces valid la conturile furnizorilor.

**Versiunea actualizată cu Gmail este publicată pe https://voxa-growth.vercel.app din 14 octombrie 2026, în modul de test. Clientul Google a fost configurat pe 15 octombrie; mai sunt necesare conectarea căsuțelor și testele interne. În această implementare nu au fost trimise mesaje reale către prospecte.** Supabase este conectat, migrările sunt aplicate tranzacțional, autentificarea este configurată și izolarea organizațiilor a fost verificată pe proiectul real.

## Pornire și cont

Necesită Node.js 24+ și npm. Din acest director:

```powershell
npm ci
npm run dev
```

Deschide `http://localhost:3000`. Configurează `VOXA_ADMIN_EMAIL` în `.env.local` pentru proprietarul organizației VoxaTech. Sesiunea inițială este deschisă în browserul aplicației. În **Setări → Contul tău**, stabilește propria parolă de minimum 12 caractere. Nu există înscriere publică.

Pentru versiunea optimizată locală: `npm run build`, apoi `npm run start`.

Evaluările cu liste reale folosesc `scripts/evaluation-leads.local.json`, exclus din Git. Copiază `scripts/evaluation-leads.example.json` sub acest nume și înlocuiește numai local datele fictive; nu publica liste de prospecte în repository.

## Funcționalități

- Dashboard, prospecte, detalii, campanii, conversații, demo-uri, cunoștințe, analize, setări și integrări, cu date Supabase reale, stări goale și erori explicite.
- Autentificare verificată pe server, roluri owner/admin/operator/viewer, RLS pe 29 de tabele, organizații, audit și fișiere private.
- Creare/editare, filtre, selecție multiplă, export CSV protejat împotriva formulelor, import cu mapare/previzualizare, rezultate pe rând și deduplicare.
- Campanii cu audiență, scor minim/sursă, expeditor, ton, ofertă, limită zilnică, interval București, maximum două reveniri, aprobare/mod automat și activare/pauză/arhivare.
- Ciorne editabile, aprobare explicită, răspuns manual, suprimare, oprirea revenirilor la răspuns și sarcini pentru intervenție umană.
- Bază de cunoștințe cu categorii, activare, ștergere logică și istoric de versiuni; instrucțiuni AI și modele editabile.
- Toate cele nouă tipuri de joburi, scheduler atomic, lease, fencing token, retry, audit, procesare manuală și rezumat zilnic în aplicație.
- Pagini demo/onboarding cu token aleatoriu și expirare, audio privat cu URL-uri temporare, evenimente de vizualizare/ascultare și formular de configurare.
- Adaptere implementate pentru Google Gemini, Resend, ElevenLabs și Stripe. Cheile lipsă sunt afișate drept **Neconfigurat**. Starea Gemini devine verificată numai după un apel reușit prin SDK-ul nativ.
- WhatsApp: interfață de adaptor, canal/conversații în baza de date, ciorne de șabloane și endpoint neactiv. **Nu este o conexiune WhatsApp funcțională**; necesită furnizor, verificarea webhook-ului, aprobarea șabloanelor și dovada consimțământului.

Fără cheia Gemini, jobul raportează configurația lipsă și nu inventează rezultate AI. Dacă Gemini este disponibil, dar ElevenLabs lipsește, scenariul este salvat și afișat fără audio. Modul email rămâne `log`; configurarea AI nu activează livrarea.

## Variabile de mediu

`.env.local` conține configurația locală și este exclus din Git. Nu pune secrete în Settings, documente, notițe sau în variabile publice.

| Variabilă                        | Utilizare                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | URL HTTPS al proiectului existent                                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Cheie publică; RLS rămâne obligatoriu                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`      | Numai server: worker, webhook-uri, stocare și administrare                               |
| `SUPABASE_ACCESS_TOKEN`          | Administrare locală pentru migrări/Auth; **nu îl publica în Vercel**                     |
| `APP_URL`                        | Originea exactă, local `http://localhost:3000`; HTTPS în producție                       |
| `GEMINI_API_KEY`                 | Cheie server pentru Google Gemini                                                        |
| `AI_PROVIDER`                    | Implicit `google_gemini`                                                                 |
| `DEFAULT_AUTOMATION_MODEL`       | Implicit `gemini-3.8-flash`                                                              |
| `GEMINI_INPUT_COST_PER_MILLION`  | Cost implicit estimat pentru un milion de tokenuri de intrare                            |
| `GEMINI_OUTPUT_COST_PER_MILLION` | Cost implicit estimat pentru un milion de tokenuri de ieșire și gândire                  |
| `RESEND_API_KEY`                 | Acces la emailuri trimise și primite                                                     |
| `RESEND_FROM_EMAIL`              | Expeditorul verificat în Resend                                                          |
| `INTERNAL_TEST_EMAIL`            | Singura adresă permisă pentru acțiunea internă „Trimite test mie”                        |
| `RESEND_WEBHOOK_SECRET`          | Verificarea semnăturilor Resend                                                          |
| `RESEND_INBOUND_DOMAIN`          | Domeniu de recepție fără protocol, pentru `reply+token@domeniu`                          |
| `EMAIL_FROM`                     | Expeditor verificat de rezervă; campania poate avea propria identitate verificată        |
| `EMAIL_DELIVERY_MODE`            | `log` implicit; `live` activează posibilitatea livrării, sub toate controalele campaniei |
| `ELEVENLABS_API_KEY`             | Generare audio                                                                           |
| `ELEVENLABS_VOXA_VOICE_ID`       | Vocea recepționerului AI                                                                 |
| `ELEVENLABS_PATIENT_VOICE_ID`    | Vocea pacientului fictiv                                                                 |
| `STRIPE_SECRET_KEY`              | Cheie Stripe; începe cu modul de test                                                    |
| `STRIPE_WEBHOOK_SECRET`          | Verificarea semnăturilor Stripe                                                          |
| `STRIPE_PRICE_ID`                | Preț configurat în Stripe pentru checkout                                                |
| `CRON_SECRET`                    | Secret aleatoriu de minimum 32 de caractere; o valoare locală este deja generată         |

Repornește aplicația după modificări. Setările AI ale organizației din interfață au prioritate față de valorile implicite de mediu.

## Supabase

```powershell
npm run db:migrate
npm run auth:configure
npm run db:verify
```

Migrările din `supabase/migrations` sunt aplicate tranzacțional, sub lock, cu checksum în `private.voxa_migrations`. Rerularea este sigură. Nu edita migrări deja aplicate; creează una nouă. Nu amesteca aplicarea manuală în SQL Editor cu runner-ul fără reconcilierea registrului.

Auth este configurat pentru invitații, confirmarea emailului, parole de minimum 12 caractere, rotația tokenurilor și callback exact la `APP_URL/auth/callback`. La lansare setează originea HTTPS și rerulează configurarea. Emailurile de invitație/recuperare trimise de Supabase necesită SMTP Auth configurat în dashboard, separat de emailurile campaniilor.

Conturile noi primesc un profil, **nu și acces automat**. Un administrator de încredere atribuie explicit organizația și rolul:

```sql
insert into public.organization_members (organization_id, user_id, role)
values ('10000000-0000-4000-8000-000000000001', '<auth-user-uuid>', 'operator');
```

Cheia service-role ocolește RLS și există numai în module `server-only`. Cererile normale folosesc sesiunea și RLS. Identitatea organizației este imuabilă; FK-urile includ organizația. Utilizatorii nu își pot modifica rolul, auditul sau istoricul prin API-ul public.

Bucket-urile `voxa-demos` și `voxa-knowledge` sunt private, cu căi prefixate prin UUID-ul organizației. Demo-urile și formularele onboarding expiră după 30 de zile. `demos.revoked_at` revocă un demo. API-ul de stocare permite upload-uri de cunoștințe numai administratorilor; audio este încărcat de server.

Migrările însămânțează VoxaTech și FAQ-ul verificat, fără prospecte fictive. `supabase/seed.local.sql` este un exemplu exclusiv local, protejat prin `SET voxa.environment = 'local'`; nu este aplicat pe proiectul găzduit.

## Google Gemini

Adaptorul folosește SDK-ul nativ oficial `@google/genai`, modelul stabil `gemini-3.8-flash`, răspunsuri JSON constrânse prin JSON Schema și validare Zod. Furnizorul și modelul sunt salvate în **Setări → Asistentul AI**. OpenAI nu este necesar. Interfața `AIProvider` rămâne extensibilă pentru alți furnizori.

Îmbogățirea, scorarea, sumarizarea, redactarea, revenirile, clasificarea și rezumatele CRM folosesc nivelul de gândire `low`. Răspunsurile către prospect, obiecțiile și scenariile demo folosesc `medium`. Fiecare activitate AI păstrează furnizorul, versiunea reală a modelului, nivelul de gândire, latența, tokenurile de intrare/ieșire/gândire/cache/total și costul estimat.

Pentru configurare locală, adaugă cheia numai în `.env.local` din rădăcina acestui proiect, pe linia `GEMINI_API_KEY=`. Nu o adăuga în `.env.example`, în Settings, în Git sau într-o variabilă cu prefixul `NEXT_PUBLIC_`. Păstrează `EMAIL_DELIVERY_MODE=log`, apoi repornește aplicația. Testul controlat folosește un singur prospect fictiv și conținut sintetic, salvează intrarea, ieșirea și utilizarea în jurnal și creează exclusiv o ciornă:

```powershell
npm run ai:test
```

Analiza vizitează numai site-ul public indicat. Blochează adresele private/locale, fixează IP-ul conexiunii, limitează dimensiunea/timpul și acceptă redirectări numai pe același hostname. Site-urile inaccesibile produc o eroare revizuibilă. Faptele trebuie susținute de citate găsite în text; absența unei mențiuni nu dovedește lipsa unei funcții.

## Resend

1. Verifică domeniul expeditorului și configurează `RESEND_API_KEY` și `RESEND_FROM_EMAIL`.
2. Configurează `INTERNAL_TEST_EMAIL`. Acțiunea „Trimite test mie” nu primește o adresă din browser și poate trimite exclusiv la această valoare de pe server.
3. Configurează recepția și `RESEND_INBOUND_DOMAIN`.
4. Înregistrează `https://<app>/api/webhooks/resend` pentru `email.received`, `email.sent`, `email.delivered`, `email.opened`, `email.bounced`, `email.complained`, `email.suppressed` și `email.failed`.
5. Salvează secretul webhook. Semnătura este verificată pe corpul brut.
6. Păstrează `EMAIL_DELIVERY_MODE=log` și testează numai cu adresa internă înainte de mesaje către prospecte.

Răspunsurile sunt asociate prin tokenul adresei de reply și verificarea expeditorului cu emailul prospectului. Mesajele necorelate sau de la alt expeditor nu sunt atașate automat. Refuzurile, dezabonările și bounce-urile opresc contactarea. GET-ul linkului de dezabonare cere confirmare; POST suportă one-click.

Modul `log` păstrează mesajele și jurnalul fără a apela trimiterea către prospecte. Review & Launch Center verifică din nou pe server domeniul expeditor, adresele fără placeholder, aprobarea fiecărei ciorne, identitatea VoxaTech, linia de opt-out, plafonul zilnic de maximum 10 și confirmarea manuală. Live necesită toate acestea plus `EMAIL_DELIVERY_MODE=live`. Nici configurarea unei chei, nici generarea unei ciorne nu activează singure o campanie.

Rezervările sunt atomice și cheia de idempotency a furnizorului este stabilă. Livrările incerte mai vechi de 23 de ore cer intervenție, deoarece [Resend păstrează cheile 24 de ore](https://resend.com/changelog/idempotency-keys). Nu crea un mesaj nou pentru o livrare ambiguă înainte de verificarea furnizorului. Mesajele deja predate furnizorului nu pot fi retrase prin modificarea bazei de date.

## ElevenLabs și demo-uri

Configurează cheia și două voci pentru română. Scenariul este generat primul; replicile sunt sintetizate separat cu vocea fiecărui rol, salvate în Storage și redate în ordine. Durata audio efectivă este verificată în intervalul 35–60 secunde; altfel demo-ul raportează eroare și trebuie regenerat. Retry-ul reutilizează segmentele salvate.

Fără ElevenLabs, scenariul este disponibil ca „Audio în așteptarea configurării”. Pagina este marcată „Simulare demonstrativă VoxaTech”. Nu folosește Retell/Telnyx. Vizualizarea și începutul ascultării sunt înregistrate o singură dată.

## Stripe și onboarding

Configurează prețul și cheile de test. Înregistrează `https://<app>/api/webhooks/stripe` pentru `checkout.session.completed` și `checkout.session.async_payment_succeeded`. Numai un webhook valid cu plata confirmată actualizează venitul și creează onboarding-ul; pagina de succes din browser nu este dovadă de plată.

În prospect → Conversație, pregătește linkul de plată, salvat ca ciornă. După plată, worker-ul creează formularul și mesajul tranzacțional, respectând controalele de livrare și suprimarea. Linkul formularului este disponibil și în dashboard. Colectează clinică, servicii, program, salut, transfer, reguli de programare, calendar și contact. Nu colectează parole/date medicale. `PaymentProvider` permite Netopia ulterior.

## Cron

Programarea Vercel Cron este dezactivată în configurația inițială. Endpoint-ul `/api/cron` verifică în continuare `Authorization: Bearer <CRON_SECRET>` constant-time și nu rulează fără un secret valid. La lansare, adaugă programarea de 15 minute în `vercel.json` numai împreună cu un plan compatibil și după activarea deliberată a livrării.

Worker-ul are maximum 300 secunde, revendică pe rând joburi cu lease de cinci minute și oprește revendicările înainte de expirarea bugetului. Erorile au backoff exponențial; așteptarea intervalului de trimitere nu consumă retry-uri. Scheduler-ul și plățile sunt idempotente. Local folosește **Setări → Procesează acum**; nu există cron local automat.

Rezumatul este pus în coadă la prima invocare de la/după 18:30 Europe/Bucharest, cu DST. Un backlog poate întârzia procesarea. Notificările sunt în aplicație; `NotificationProvider` permite adăugarea ulterioară a unui adaptor email.

## Prima campanie

1. Stabilește parola și completează FAQ-ul, oferta și prețurile reale în Baza de cunoștințe.
2. Configurează Google Gemini și verifică testul controlat. Configurează Resend numai când ești pregătit să testezi emailul; păstrează modul `log`.
3. Importă un lot mic, verifică maparea/duplicatele și procesează analiza din Setări.
4. Creează campania cu aprobare obligatorie, plafon mic și expeditor verificat.
5. Selectează prospectele potrivite, asociază campania, generează și revizuiește ciornele în Conversații.
6. Testează livrarea și răspunsul cu o adresă proprie. Treci explicit la `live` și activează campania numai când ești pregătit.
7. Pentru utilizare permanentă, publică personal pe Vercel, configurează HTTPS/Auth/variabile/webhook-uri și verifică cron-ul. Nimic nu a fost publicat în această sesiune.

## Verificare

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run db:verify
node --env-file=.env.local scripts/verify-hosted-rls.mjs
```

22 de teste locale verifică SQL-ul real în PostgreSQL/PGlite: RLS, roluri, FK-uri tenant, deduplicare, o singură campanie activă per prospect, livrare dry-run, răspunsuri aprobate de om, versiuni, DST, model routing, capuri, aprobări, oprirea revenirilor, lease/retry, scheduler și plăți idempotente. Numai infrastructura auth/storage din teste este simulată; producția utilizează Supabase real.

Pentru o verificare locală completă, cu serverul pornit și `EMAIL_DELIVERY_MODE=log`:

```powershell
npm run dry-run:full
```

Comanda înlocuiește exclusiv datele cu sursa `dry-run-audit-20260925`, păstrează 20 de clinici fictive în workspace și parcurge importul, îmbogățirea/score-ul cu fixture-uri locale marcate explicit, campania, ciornele, livrarea simulată, răspunsul pozitiv, calificarea, demo-ul, checkout-ul, plata simulată și onboardingul. Nu apelează Gemini, Resend, ElevenLabs sau Stripe.

Testele HTTP au verificat sănătatea bazei, refuzul accesului neautentificat, creare/import/deduplicare, worker, campanii, istoric documente, ciorne/aprobare/suprimare și toate rutele protejate. Datele temporare au fost curățate. Desktopul, formularul de prospect și afișarea mobilă au fost inspectate în browser.

`scripts/test-app.mjs` este pentru acest checkout local și administratorul inițial: creează/curăță date de verificare și refuză modul live. Nu îl rula într-un mediu utilizat de clienți reali fără adaptare. Utilitarele de provisioning și migrări sunt privilegiate și nu sunt endpoint-uri publice.

Înainte de lansare rămân testele live cu propriile conturi ale furnizorilor, webhook-urile/vocile, SMTP Auth și HTTPS. WhatsApp nu are furnizor activ. Costurile sunt estimări bazate pe tariful introdus în Setări. Ratele de status din Analize descriu cohorta curentă; deschiderile emailului nu dovedesc citirea umană.
