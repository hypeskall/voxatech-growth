# Campanii pe nișe și Inbox — 16 octombrie 2026

## Cum folosești campaniile

1. Deschide **Leads → Campanie nouă**. Introdu un nume, de exemplu „Stomatologie · București”, și opțional nișa.
2. Alege campania din lista **Campanie**.
3. Apasă **Import Excel / CSV**. Câmpul **Campania pentru aceste leaduri** este deja completat; verifică fișierul și confirmă importul. Sunt acceptate până la 5.000 de leaduri pe foaie, în loturi de 100.
4. Pentru leaduri existente, selectează rândurile, alege campania și apasă **Mută … leaduri selectate aici**. Pune Autopilot în pauză înainte de mutare.
5. În **Autopilot → Campania care rulează**, alege lista dorită. După activarea livrării live și aprobarea mesajului, **Pornește Autopilot** folosește numai acea listă.
6. Pentru a schimba campania, pune Autopilot în pauză, alege alta și confirmă din nou pornirea. Lucrările netrimise din campania veche sunt oprite. Istoricul mesajelor rămâne disponibil.

O singură campanie de leaduri rulează în același timp pentru toate căsuțele conectate. Programul rămâne luni–vineri, 09:30–16:30, ora României. Limitele se împart între mesajele inițiale, teste și răspunsuri. Leadurile contactate sau dezabonate nu sunt contactate din nou de o altă campanie.

Leadurile noi importate într-o campanie sunt cercetate înainte de redactarea mesajului, în lotul programat. Importul nu cercetează imediat întreaga listă și nu activează trimiterea.

## Inbox

- **Toate răspunsurile** afișează conversațiile care au primit cel puțin un răspuns, cu expeditorul și căsuța destinatară.
- **Hot leads** folosește ultimul răspuns din conversație și clasificarea AI: interes concret pentru demo, test, ofertă sau discuție comercială, cu încredere de minimum 0,85. Refuzurile, dezabonările, contactele suprimate și nepotrivirile de expeditor sunt excluse. Clasificarea trebuie verificată de om înainte de a răspunde.
- Mesajele istorice fără clasificarea nouă nu sunt prezentate automat ca hot. Conversațiile fără răspuns nu sunt incluse în aceste două secțiuni.

WhatsApp, ElevenLabs și Stripe au fost eliminate din interfața de integrări și din fluxurile active. Crearea demo-urilor vocale și linkurilor Stripe este dezactivată; webhookurile vechi returnează 410. Istoricul existent nu a fost șters.

## Verificări

- 73 de teste trecute, inclusiv două liste de câte 2.000 de leaduri, selecție izolată, refuzarea schimbării în timpul rulării și izolarea între organizații.
- Verificare în producție: Stomatologie — 10 leaduri existente; Kinetoterapie — 0 leaduri; importul preselectează campania.
- Dashboard: răspunsul de date a scăzut de la 271.733 la 47.282 bytes, aproximativ 83%. Cererile de verificare au durat 3.118 ms înainte și 1.206 ms după; acestea sunt măsurători punctuale, nu o garanție pentru orice conexiune.
- Ultima publicare: `dpl_7ghPih7BkcnKDjY1oLamhznEfm14`, READY, pe `https://voxa-growth.vercel.app`.
- Stare la publicare: 9 Gmail conectate și testate, câte 10 trimiteri/zi; Gemini 3.1 Flash-Lite; livrare `log`; Autopilot în pauză. Nu au fost trimise emailuri către leaduri în timpul verificării.
