# Import Excel în Voxa

1. Deschide **Leads → Import Excel / CSV**.
2. Alege fișierul. Sunt acceptate `.xlsx`, `.xls`, `.xlsm`, `.xlsb`, `.xltx`, `.xltm`, `.xlt`, `.xml` (foaie Excel), `.csv`, `.tsv` și `.ods`.
3. Voxa detectează foaia și coloanele uzuale în română sau engleză. Dacă este nevoie, alege altă foaie și rândul cu numele coloanelor. Pentru fișiere fără antet alege **Fără antet**.
4. Verifică **Companie**, **Email**, **Site web** și celelalte coloane. Compania este obligatorie. Folosește paginile previzualizării pentru a exclude rânduri.
5. Apasă **Importă … prospecte**. Importul se face în loturi de 100; duplicatele existente sunt omise. Rândurile invalide sunt afișate și nu împiedică importul celor valide.
6. Pentru mai multe foi, selectează și importă separat fiecare foaie dorită. Rezultatul arată numărul de prospecte adăugate și rândurile omise.

Fișiere: maximum 10 MB, 40 de foi, 5.000 de prospecte și 100 de coloane pe foaie. Fișierele prea mari sunt respinse, fără trunchiere silențioasă. Pentru celule cu mai multe emailuri se folosește prima adresă validă. Parolele trebuie eliminate în Excel înainte de import. Formulele și macrocomenzile nu sunt executate; sunt citite valorile salvate.

Citirea fișierului și previzualizarea au loc în browser. Numai rândurile confirmate sunt trimise către Voxa. Importul nu activează livrarea și nu pornește Autopilot; dacă Autopilot este pornit ulterior, acesta poate prelua leadurile eligibile importate.

Setări curente: 9 căsuțe Gmail, 10 trimiteri/căsuță/zi; Gemini 3.1 Flash-Lite. Livrarea rămâne în modul `log`, Autopilot în pauză, până la aprobarea activării.
