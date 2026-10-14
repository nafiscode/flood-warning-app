-- A9 round 2: the Malay of the flood alert templates, reviewed again with Gemini, this time with
-- the English as the source (decision 15 Oct 2026). Gemini rewrote the Malay, a fresh run that never
-- saw the English or Thai translated the result back into English, and Claude checked both against
-- the Thai, which decides where the two sources differ. Only the Watch reason changes; the three
-- rewrites that dropped words the Thai has were rejected. A row whose Malay an admin has changed
-- since is left alone (the "where ... = old" guard). Alerts already issued keep their words.

update public.alert_templates
   set reason = jsonb_set(reason, '{ms}', to_jsonb($ms$Hujan lebat berterusan dan paras air ada tanda hendak naik.$ms$::text)),
       updated_at = now()
 where code = 'flood_watch'
   and reason ->> 'ms' = $ms$Hujan lebat berterusan dan paras air cenderung naik.$ms$;
