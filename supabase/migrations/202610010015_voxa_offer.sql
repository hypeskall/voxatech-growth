-- Product facts explicitly supplied by the owner; immutable versions retain previous wording.
update public.knowledge_base_documents
set title='Voxa — produs și test gratuit',
content='Produsul se numește Voxa. Voxa oferă un singur sistem pentru programări, pacienți, fișe și activitatea recepției. Oferta aprobată este: 30 de zile de test complet gratuit, fără nicio obligație ulterior. Se poate oferi un demo scurt. Nu afirma economii sau rezultate măsurate pentru o clinică fără dovezi. Nu inventa integrări, prețuri sau condiții după perioada gratuită. Semnătura aprobată pentru primul email este: Cu respect, Rares | voxatech.ro. Răspunsurile sunt direcționate către contact@voxatech.ro.', active=true
where organization_id='10000000-0000-4000-8000-000000000001' and title='VoxaTech — întrebări frecvente';
insert into public.settings(organization_id,key,value)
values('10000000-0000-4000-8000-000000000001','product_offer','{"product_name":"Voxa","trial_days":30,"trial_free":true,"no_further_obligation":true,"reply_to":"contact@voxatech.ro","signature":"Cu respect, Rares | voxatech.ro"}')
on conflict(organization_id,key) do update set value=excluded.value;
