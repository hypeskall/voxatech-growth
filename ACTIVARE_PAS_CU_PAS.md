# Voxa Growth — activare pas cu pas

Versiunea Gmail a fost publicată pe 14 octombrie 2026 la https://voxa-growth.vercel.app. Baza de date și programarea la fiecare cinci minute sunt configurate. Adresa internă de test și secretul programării au fost restaurate din configurația existentă și verificate. Livrarea rămâne în modul de test; nu există încă nicio căsuță Gmail conectată.

Actualizare, 15 octombrie 2026: fișierul Google a fost primit, clientul și cheia de criptare au fost configurate local și în Vercel, iar noua versiune a fost publicată. Butonul **Conectează Gmail** este disponibil în site. Continuă direct la **pasul 7**: conectarea căsuțelor și testele interne. Livrarea automată este încă oprită.

## 1. Pregătește contul Voxa și deschide proiectul corect

Preview: [Voxa local](http://localhost:3014/dashboard). Dacă nu mai rulează, deschide PowerShell și execută:

```powershell
Set-Location -LiteralPath 'C:\Users\mihai\.gemini\antigravity\scratch\codex auto\voxa-growth'
$env:APP_URL='http://localhost:3014'
npm run dev -- --port 3014
```

Păstrează această fereastră deschisă cât folosești previewul. Dacă nu ai stabilit o parolă Voxa, fă acest lucru personal în **Setări → Contul tău**. Același cont Supabase va fi folosit pe site-ul publicat. Parolele se introduc doar în aplicație și Google, nu în chat.

## 2. Accesul Vercel și prima publicare sunt gata

Acest pas a fost finalizat pe 14 octombrie 2026. Proiectul existent **voxa-growth** este accesibil și noua versiune este publicată în modul de test. Urmează configurarea Google; după salvarea clientului Google va fi necesară încă o publicare pentru aplicarea acelor setări.

## 3. Activează Gmail API în Google Cloud

1. Deschide [Google Cloud](https://console.cloud.google.com/) și autentifică-te.
2. Selectează proiectul pe care vrei să îl folosești pentru Voxa; creează unul dacă nu ai un proiect potrivit.
3. Mergi în **APIs & Services → Library**, caută **Gmail API** și apasă **Enable**.
4. În **Google Auth Platform → Branding**, configurează numele „Voxa Growth”, adresa de suport și adresa de contact.
5. Pentru conturi Gmail personale, configurează audiența **External**. În etapa **Testing**, adaugă fiecare Gmail pe care îl vei conecta în lista de **Test users**.
6. În **Data Access**, configurează permisiunile `openid`, `email`, `https://www.googleapis.com/auth/gmail.send` și `https://www.googleapis.com/auth/gmail.readonly`.

`gmail.readonly` permite sincronizarea răspunsurilor. Aplicația importă doar conversațiile începute prin Voxa. Permisiunea oferită de Google este însă mai largă decât această selecție, deci conturile se conectează prin aprobarea ta în Google.

Pentru funcționare continuă, finalizează ulterior publicarea și verificarea OAuth aplicabile aplicației. Cu Gmail și o aplicație External în Testing, tokenurile de reînnoire expiră după șapte zile. `gmail.readonly` este o permisiune restricționată; Google poate cere verificări suplimentare în funcție de distribuția și utilizarea aplicației. Urmează cerințele afișate pentru proiectul tău. [Documentație Google despre audiență](https://support.google.com/cloud/answer/15549945), [permisiuni Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

## 4. Creează clientul Google și descarcă fișierul

În **Google Auth Platform → Clients → Create client**:

1. Alege **Web application** și numește clientul „Voxa Growth Web”.
2. În **Authorized redirect URIs**, adaugă exact:

   ```text
   https://voxa-growth.vercel.app/api/gmail/callback
   http://localhost:3014/api/gmail/callback
   ```

3. Creează clientul și descarcă fișierul JSON atunci când Google îl oferă. Păstrează-l privat.
4. În directorul `voxa-growth`, creează folderul `.secrets` și salvează fișierul ca **google-client.json** în acesta.

Google cere potrivirea exactă a adresei de revenire. Clientul trebuie să fie de tip Web, nu Desktop sau service account. [Pașii oficiali OAuth Web](https://developers.google.com/identity/protocols/oauth2/web-server).

## 5. Configurează Gmail pe server

În a doua fereastră PowerShell:

```powershell
node --env-file=.env.local scripts/configure-gmail-client.mjs .secrets/google-client.json
```

Scriptul configurează clientul Google și cheia de criptare local și în proiectul Vercel existent. Setările sunt păstrate private; parola Gmail nu este necesară. Livrarea nu este pornită de acest pas.

Adresa proprie de test este deja configurată în `INTERNAL_TEST_EMAIL`. O poți verifica personal în `.env.local`; dacă vrei alta, alege o căsuță proprie care nu apare în leaduri și modifică acea valoare înainte de comanda de mai sus.

Dacă accesul Vercel este încă blocat, poți pregăti numai previewul local:

```powershell
node --env-file=.env.local scripts/configure-gmail-client.mjs .secrets/google-client.json --local-only
```

Această variantă nu configurează producția. După restabilirea accesului, rulează comanda fără `--local-only` și publică. Păstrează cheia `GMAIL_TOKEN_ENCRYPTION_KEY` între publicări; schimbarea ei face conexiunile salvate imposibil de citit.

## 6. Publică versiunea Gmail în modul de test

În Vercel, la proiectul **voxa-growth → Settings → Environment Variables**, verifică pentru **Production**:

| Setare                                                 | Valoare sau sursă                                      |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `APP_URL`                                              | `https://voxa-growth.vercel.app`                       |
| `EMAIL_DELIVERY_MODE`                                  | `log`, până trec testele interne                       |
| `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` | Configurate de scriptul din pasul 5                    |
| `GMAIL_TOKEN_ENCRYPTION_KEY`                           | Aceeași cheie păstrată de script                       |
| `INTERNAL_TEST_EMAIL`                                  | Adresa ta proprie de test                              |
| `GEMINI_API_KEY`                                       | Configurația AI existentă                              |
| `AUTOPILOT_CRON_SECRET`                                | Secretul existent, același ca în Supabase Vault        |
| Cheile Supabase existente                              | Se păstrează; cheia service-role rămâne doar pe server |

`SUPABASE_ACCESS_TOKEN` este pentru administrarea locală și nu se publică în Vercel.

Publică din directorul proiectului:

```powershell
npm exec --cache ./.tool-cache --yes --package vercel -- vercel deploy --prod --global-config "$env:APPDATA/com.vercel.cli/Data"
```

Comanda trebuie să folosească proiectul existent **voxa-growth**. `.vercelignore` exclude fișierele locale cu secrete și ajutorul temporar de autentificare.

Deschide [Voxa Growth](https://voxa-growth.vercel.app/dashboard) și verifică noul dashboard Gmail. Publicarea în modul `log` nu autorizează contactarea leadurilor.

## 7. Conectează și testează fiecare căsuță

1. În site-ul publicat, deschide **Setări → Integrări → Conectează Gmail**.
2. Alege primul cont în Google și acordă permisiunile cerute.
3. Repetă pentru celelalte conturi. Nu trebuie să rămână autentificate în browser pentru ca serverul să funcționeze.
4. Lasă inițial limita la **5 trimiteri pe zi** pentru fiecare căsuță.
5. Apasă **Trimite test intern** pentru fiecare și verifică efectiv primirea mesajului în căsuța ta de test, inclusiv Spam.

Testele interne trimit emailuri reale numai la adresa configurată de tine, chiar dacă livrarea campaniilor este în modul `log`. Testul folosește plafonul acelei căsuțe și există minimum zece minute între trimiterile noi din același cont. Nu trebuie să aștepți zece minute ca să testezi un alt cont.

După reconectarea unui cont, testul trebuie repetat. Un test acceptat de Google nu garantează că mesajul ajunge în Inbox, de aceea verifici primirea personal.

## 8. Permite livrarea reală și pornește din buton

1. După testele primite, schimbă numai `EMAIL_DELIVERY_MODE` în **`live`** în variabilele Production din Vercel.
2. Fă **Redeploy** pentru ca noua valoare să fie aplicată.
3. În Voxa, verifică leadurile importate și mesajul aprobat pentru oferta ta în **Dashboard / Autopilot**.
4. Apasă **Pornește Autopilot**, citește mesajul și confirmă **Aprobă și pornește**.

Serverul continuă apoi procesarea fără calculatorul tău. Trimiterile sunt luni–vineri, **09:30–16:30, ora Bucureștiului**. Când nu mai are leaduri eligibile, așteaptă următorul import. Un lead este repartizat unei singure căsuțe; un contact deja suprimat sau cu un răspuns primit nu primește o nouă abordare inițială.

Cu zece căsuțe și limita de cinci, plafonul este de **50 de cereri noi de trimitere pe zi de lucru**, împărțit între primele emailuri, răspunsuri și teste. În ziua în care testezi zece căsuțe, testele consumă zece din aceste locuri. Limita conservatoare a aplicației nu este o garanție împotriva filtrării sau blocării de către Google. [Cerințele Google pentru expeditori](https://support.google.com/mail/answer/81126).

## 9. Verifică inboxul și funcționarea fără PC

În **Inbox**, vezi adresa reală a expeditorului, căsuța care a primit răspunsul, subiectul și istoricul. Poți căuta după email sau companie și filtra după căsuță ori **Necesită atenție**. Atașamentele sunt enumerate; fișierele se deschid în Gmail.

Programarea verifică serverul la fiecare cinci minute. Pagina deschisă actualizează datele aproximativ la fiecare 15 secunde; aceasta este afișarea datelor deja sincronizate, nu o sincronizare Gmail la fiecare 15 secunde. La un istoric mare sau erori Google, importul răspunsurilor poate dura mai multe cicluri. **Actualizează răspunsurile** permite și o verificare manuală.

La primul răspuns real dintr-o conversație pornită de Voxa, verifică adresele și istoricul în Inbox. Închide browserul și verifică mai târziu că istoricul continuă să se actualizeze pe site. Întrebările sensibile pentru ofertă și expeditorii diferiți de adresa leadului sunt trimise la verificare umană. Rezervarea automată în calendar nu este implementată.

Poți verifica pregătirea fără să trimiți sau să pornești nimic:

```powershell
node --env-file=.env.local scripts/check-gmail-setup.mjs
```

Verificarea citește configurația locală, conexiunile din baza de date, secretul programării și existența versiunii Gmail publicate. Nu confirmă singură toate valorile efective din Vercel: testele din site-ul publicat și prima livrare reală verifică acea parte. Dacă ai activat `live` numai în Vercel, avertismentul local despre modul `log` este de așteptat.

## 10. Oprire și probleme uzuale

| Ce vezi                                | Ce faci                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403` în Vercel                        | Autentifică-te în contul corect și verifică accesul la echipa proiectului.                                                                                                      |
| `redirect_uri_mismatch` în Google      | Copiază exact callback-ul din pasul 4 în clientul Web corect.                                                                                                                   |
| Google nu permite contul               | În Testing, adaugă acel Gmail la Test users și verifică aprobarea ambelor permisiuni Gmail.                                                                                     |
| Autopilot nu se poate porni            | Verifică clientul Google, AI, secretul programării, conturile conectate, testele și modul `live` după redeploy.                                                                 |
| Gmail cere reconectare după șapte zile | Verifică statusul OAuth Testing / In production și cerințele Google; reconectează și repetă testul.                                                                             |
| Autopilot este pornit, dar așteaptă    | Verifică ora de lucru, plafonul, pauza de zece minute și dacă mai există leaduri eligibile.                                                                                     |
| Căsuță în pauză / livrare incertă      | Verifică folderul Trimise din Gmail. O cerere incertă nu este repetată automat, pentru a evita dublurile. Reconectarea nu retrimite automat acel mesaj.                         |
| Răspunsul nu apare                     | Verifică dacă este în conversația pornită prin Voxa, apoi Actualizează răspunsurile și conexiunea Gmail. Emailurile personale fără legătură nu sunt importate.                  |
| Vrei să oprești                        | Apasă **Pune în pauză**. Noile trimiteri ale Autopilot se opresc; sincronizarea inboxului continuă pentru căsuțele conectate. O cerere deja predată Google nu poate fi retrasă. |

Detalii de implementare și administrare: [GMAIL_SETUP.md](GMAIL_SETUP.md).
