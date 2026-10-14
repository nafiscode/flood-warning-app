-- A9: the Malay of the four flood alert templates, reviewed with Gemini (decision 14 Oct 2026).
-- Each Malay line was rewritten, translated back into Thai without seeing the Thai, and checked
-- against the Thai source by Claude. Only the Malay changes. A row whose Malay an admin has
-- already changed since is left alone (the "where ... = old" guard). Alerts already issued keep
-- the words they were issued with.

update public.alert_templates
   set messages = jsonb_set(messages, '{ms}', to_jsonb($ms$Pindah segera di {area}. Pergi ke tempat selamat sekarang. Jangan berjalan atau memandu melalui air deras. Jika terperangkap, tekan SOS dalam aplikasi atau telefon 1784 atau 1669.$ms$::text)),
       updated_at = now()
 where code = 'flood_evacuate'
   and messages ->> 'ms' = $ms$Pindah segera di {area}. Pergi ke tempat selamat sekarang. Jangan berjalan atau memandu merentasi air yang deras. Jika terperangkap, tekan SOS dalam aplikasi atau hubungi 1784 atau 1669.$ms$;

update public.alert_templates
   set label = jsonb_set(label, '{ms}', to_jsonb($ms$Boleh balik rumah (air surut)$ms$::text)),
       updated_at = now()
 where code = 'flood_return'
   and label ->> 'ms' = $ms$Selamat pulang (air surut)$ms$;

update public.alert_templates
   set messages = jsonb_set(messages, '{ms}', to_jsonb($ms$Boleh balik rumah di {area}. Balik dengan berhati-hati. Awas jalan rosak, elektrik bocor dan binatang berbisa. Jangan hidupkan elektrik di rumah sehingga diperiksa selamat.$ms$::text)),
       updated_at = now()
 where code = 'flood_return'
   and messages ->> 'ms' = $ms$Selamat pulang di {area}. Pulang dengan berhati-hati; awasi jalan rosak, kebocoran elektrik dan haiwan berbisa. Jangan hidupkan elektrik di rumah sehingga diperiksa selamat.$ms$;

update public.alert_templates
   set messages = jsonb_set(messages, '{ms}', to_jsonb($ms$Amaran banjir di {area}. Pindahkan orang tua, kanak-kanak, orang sakit dan kenderaan ke tempat selamat sekarang. Angkat barang ke tempat tinggi dan ikuti pengumuman seterusnya.$ms$::text)),
       updated_at = now()
 where code = 'flood_warning'
   and messages ->> 'ms' = $ms$Amaran banjir di {area}. Pindahkan warga emas, kanak-kanak, pesakit dan kenderaan ke tempat selamat sekarang, angkat barang ke tempat tinggi, dan ikuti makluman seterusnya.$ms$;

update public.alert_templates
   set reason = jsonb_set(reason, '{ms}', to_jsonb($ms$Hujan lebat berterusan dan paras air cenderung naik.$ms$::text)),
       updated_at = now()
 where code = 'flood_watch'
   and reason ->> 'ms' = $ms$Hujan lebat berterusan dan paras air cenderung meningkat.$ms$;

update public.alert_templates
   set messages = jsonb_set(messages, '{ms}', to_jsonb($ms$Berjaga-jaga banjir di {area}. Cas telefon. Sediakan dokumen penting, ubat dan beg kecemasan. Rancang laluan ke tempat selamat. Jenguk orang tua, kanak-kanak dan orang sakit di sekitar rumah.$ms$::text)),
       updated_at = now()
 where code = 'flood_watch'
   and messages ->> 'ms' = $ms$Berjaga-jaga banjir di {area}. Cas telefon, sediakan dokumen penting, ubat dan beg kecemasan, rancang laluan ke tempat selamat, dan jenguk warga emas, kanak-kanak serta pesakit berhampiran.$ms$;
