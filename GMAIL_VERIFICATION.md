# Verificarea versiunii Gmail

Verificare efectuată pe 13 octombrie 2026 pentru versiunea locală pregătită de publicare.

## Rezultate

| Verificare                                                    | Rezultat                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Testele aplicației și bazei de date                           | 57 trecute, 0 eșuate                                                                            |
| TypeScript                                                    | Trecut                                                                                          |
| Verificarea codului cu ESLint                                 | Trecut                                                                                          |
| Compilarea pentru producție                                   | Trecută, fără avertismentul rădăcinii altui proiect                                             |
| API local cu autentificare reală Supabase                     | Trecut                                                                                          |
| Acces anonim și cereri din altă origine                       | Respinse                                                                                        |
| Date Gmail sensibile în snapshot                              | Excluse                                                                                         |
| Modificarea/aprobarea/respingerea mesajelor sending și failed | Respinse                                                                                        |
| Verificarea finală înainte de rezervarea Gmail                | Opt-out, răspuns primit, oprirea în campanie, pauză și sincronizare expirată blochează livrarea |
| Migrarea suplimentară de reverificare                         | Aplicată tranzacțional pe Supabase                                                              |
| Tabelele Gmail în proiectul real                              | RLS activ, fără acces anon/authenticated; acces numai pentru server                             |
| Programare Supabase                                           | O programare activă, la fiecare cinci minute                                                    |
| Secretul programării locale                                   | Verificat față de secretul existent din Vault                                                   |
| Adresa internă de test                                        | Restaurată din configurația existentă; nu apare în leaduri                                      |
| Interfața în browser                                          | Dashboard și Inbox verificate; căutare, filtrul de atenție și afișarea ciornelor verificate     |

Testele HTTP au folosit date temporare cu sursa `gmail_integration_test` și adresă `.invalid`. Datele și înregistrările de audit aferente au fost curățate. Nu a fost executată nicio cerere reală de trimitere Gmail sau Resend în aceste verificări.

Cele patru rezultate Supabase `rls_enabled_no_policy` sunt informative pentru tabelele Gmail: absența politicilor pentru utilizatori este intenționată deoarece conturile autentificate nu au privilegii pe aceste tabele. Funcțiile de livrare sunt rezervate serverului; pornirea/pauza are verificarea separată a administratorului organizației.

## Ce nu este încă verificat live

Actualizare, 14 octombrie 2026: accesul Vercel a fost restabilit și publicarea a reușit, cu versiunea `dpl_BbRDQTH3Y5XZzwbyZCYy1C83adg3` în starea READY, la https://voxa-growth.vercel.app. Endpointul Gmail este disponibil, iar snapshotul și programarea resping accesul neautorizat. Modul de livrare este configurat `log`.

Verificarea HTTP cu autentificare Supabase a trecut și pe site-ul publicat: snapshot fără credențiale, cereri anonime/din altă origine respinse, OAuth fals respins, limită peste zece respinsă și pornire fără confirmare respinsă. Datele temporare pentru protecția mesajelor sending/failed au fost folosite numai local. Dashboardul publicat a fost verificat în browser: modul log, Autopilot în pauză, zero căsuțe și zece leaduri disponibile.

Actualizare, 15 octombrie 2026: clientul OAuth Google a fost furnizat și configurat pe server cu o cheie de criptare persistentă. Publicarea `dpl_65XSkREDLgWWoe5zAPzNh8LV7no1` este READY. Verificarea HTTP autentificată pe producție a trecut inclusiv pentru generarea URL-ului OAuth cu permisiunile Gmail și PKCE; butonul **Conectează Gmail** a fost confirmat disponibil în browser. Clientul Google și cheia sunt excluse din Git și din încărcarea fișierelor sursă în Vercel.

Există încă zero căsuțe conectate, iar Autopilot Gmail este oprit, cu livrarea în modul `log`. Schimbul real de tokenuri cu Google, livrarea și importul unui răspuns real se verifică după conectarea conturilor și testele din site. Niciun email nu a fost trimis de aceste verificări.

Adaptarea pentru ecrane mici este implementată în CSS; previzualizarea efectivă într-un viewport mobil nu a fost confirmată, deoarece browserul disponibil nu a aplicat dimensiunea cerută.

Nu este implementată rezervarea automată în calendar. Un rezultat incert de la Gmail nu este retrimis automat. Verificarea imediat înainte de livrare reduce fereastra în care starea unui lead se poate schimba; un apel deja trimis către Google nu poate fi retras.

## Repetarea verificărilor

```powershell
npm run typecheck
npm run lint
npm test
npm run build
node --env-file=.env.local scripts/test-gmail-http.mjs http://localhost:3014
node --env-file=.env.local scripts/verify-gmail.mjs
node --env-file=.env.local scripts/check-gmail-setup.mjs
```

Ultima comandă raportează intenționat „DE FĂCUT” până când configurarea și conectarea sunt complete. Este doar o verificare de citire și nu activează Autopilot.

Pentru activare: [ghid pas cu pas](ACTIVARE_PAS_CU_PAS.md).
