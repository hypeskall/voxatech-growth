# Gmail și Autopilot Voxa

Pentru activarea din conturile tale, urmează [ghidul pas cu pas](ACTIVARE_PAS_CU_PAS.md). Verificarea de pregătire, fără pornire și fără emailuri: `node --env-file=.env.local scripts/check-gmail-setup.mjs`. Pentru previewul local folosește și opțiunea `--local`.

Rezultatele verificărilor și limitele lor sunt în [GMAIL_VERIFICATION.md](GMAIL_VERIFICATION.md).

Dashboardul și Autopilot folosesc căsuțele Gmail conectate. Inboxul comun importă răspunsurile din conversațiile începute de Voxa, cu adresa expeditorului și căsuța destinatară. Emailurile personale fără legătură cu aceste conversații nu sunt importate.

## Conectarea Google, o singură dată

1. În [Google Cloud](https://console.cloud.google.com/), alege proiectul pentru Voxa și activează **Gmail API**.
2. În **Google Auth Platform**, configurează numele aplicației și adresa de contact. Pentru teste, adaugă fiecare căsuță Gmail la lista de testeri.
3. Creează un client OAuth de tip **Web application**. Adaugă exact această adresă de redirecționare:

   `https://voxa-growth.vercel.app/api/gmail/callback`

   Pentru dezvoltarea locală poți adăuga și `http://localhost:3014/api/gmail/callback`.

4. Permisiunile necesare sunt `openid`, `email`, `gmail.send` și `gmail.readonly`. Ultima permite sincronizarea răspunsurilor. OAuth în modul Testing poate produce tokenuri care expiră după șapte zile; pentru funcționare continuă, configurează publicarea și verificarea aplicabile aplicației tale. Citirea Gmail este o permisiune restricționată; cerințele Google depind de modul în care aplicația este distribuită.
5. Descarcă fișierul clientului în `.secrets/google-client.json` din acest proiect. Acest folder este exclus din Git. Nu trimite parolele conturilor Gmail în chat.
6. Configurează `INTERNAL_TEST_EMAIL` în `.env.local` cu o căsuță proprie și rulează:

   ```powershell
   node --env-file=.env.local scripts/configure-gmail-client.mjs .secrets/google-client.json
   ```

   Scriptul salvează clientul Google și o cheie de criptare pe server, apoi configurează același proiect Vercel. Cheia de criptare trebuie păstrată între deployuri. Nu o schimba după conectarea conturilor fără o migrare deliberată a tokenurilor.

   Dacă Vercel nu este încă accesibil, adaugă `--local-only` la comandă pentru a pregăti doar previewul. Rulează apoi comanda normală când ai acces; această opțiune nu configurează producția.

7. Publică versiunea actualizată și deschide **Setări → Integrări → Conectează Gmail**. Autentifică fiecare cont și acordă permisiunile Google în browser.

## Pornire și oprire

- Din fiecare căsuță, apasă **Trimite test intern** și verifică primirea mesajului. Testele intră în plafonul zilnic și respectă pauza dintre trimiteri.
- După teste, setează `EMAIL_DELIVERY_MODE=live` pe server și redeployează. Acest pas permite livrarea; nu pornește singur Autopilot.
- În Dashboard sau Autopilot, apasă **Pornește Autopilot**, verifică mesajul și confirmă **Aprobă și pornește**. Această confirmare autorizează campaniile automate ale căsuțelor conectate.
- Implicit sunt cinci trimiteri zilnice pe căsuță, configurabile între una și zece. Toate campaniile, testele și răspunsurile împart limita aceleiași căsuțe. Există minimum zece minute între cererile noi de trimitere. Plafonul este o alegere conservatoare a aplicației, nu o garanție împotriva filtrării sau blocării de către Google.
- Trimiterile sunt programate luni–vineri, 09:30–16:30, în `Europe/Bucharest`, cu schimbarea orei de vară. La atingerea plafonului, procesarea se reia într-o zi eligibilă. Când nu mai există leaduri eligibile, Autopilot așteaptă următorul import.
- Sunt excluse leadurile șterse, suprimate, contactate anterior, cu răspunsuri existente sau din surse de test/demonstrație. Leadurile CSV cu ciorne netrimise într-o campanie inactivă rămân eligibile: ciornele vechi sunt păstrate în istoric ca oprite, iar Autopilot pregătește un singur mesaj nou. Un lead nu este repartizat la mai multe căsuțe.
- La răspuns, revenirile se opresc. Clasificarea existentă poate pregăti răspunsuri și demo; întrebările despre contracte, reduceri, GDPR, integrări și expeditorii diferiți cer intervenție umană. Nu este implementată rezervarea automată în calendar.
- **Pune în pauză** oprește noile trimiteri ale Autopilot. Inboxul continuă să se sincronizeze pentru căsuțele conectate. Cererile deja predate Google nu pot fi retrase.
- La respingerea unei trimiteri sau o livrare incertă, căsuța se oprește. Gmail nu oferă chei de idempotency pentru `messages.send`; aplicația păstrează rezervarea și nu retrimite automat. Verifică folderul Trimise înainte de reconectare sau intervenție.

## Programarea pe server

Migrarea Gmail se aplică prin scriptul existent `scripts/migrate.mjs`. Programarea utilizează secretul existent în Supabase Vault și rulează la fiecare cinci minute, fără browser:

```powershell
node --env-file=.env.local scripts/configure-gmail-scheduler.mjs
```

Funcția programată sincronizează căsuțele conectate și procesează Autopilot numai după pornirea de către administrator. Conectarea Google și testele live rămân necesare; verificările locale nu dovedesc livrarea reală.

Referințe: [OAuth pentru aplicații web](https://developers.google.com/identity/protocols/oauth2/web-server), [permisiuni Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes), [cerințe pentru expeditori](https://support.google.com/mail/answer/81126).
