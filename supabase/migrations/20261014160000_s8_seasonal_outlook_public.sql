-- S8: the public line of the seasonal outlook (owner, 14 Oct 2026: "outlook public").
--
-- The table stays admins only. A visitor gets only what the map page's "Season outlook" fold says:
-- the season, the issue date, the summary lean, the Pacific's phase and how often the methods used
-- were right before. No odds per model, no notes.

create function public.public_seasonal_outlook() returns jsonb
language sql stable security definer set search_path = public as $$
  with latest as (
    select season, issued_on from public.seasonal_outlooks
    where method = 'summary'
    order by season desc, issued_on desc
    limit 1
  ), rows as (
    select o.* from public.seasonal_outlooks o join latest l using (season, issued_on)
  )
  select case when not exists (select 1 from latest) then null else jsonb_build_object(
    'season', (select season from latest),
    'issued_on', (select issued_on from latest),
    'lean', (select lean from rows where method = 'summary'),
    'pacific', (
      select case
        when (details ->> 'oni')::real >= 0.5 then 'el_nino'
        when (details ->> 'oni')::real <= -0.5 then 'la_nina'
        when details ? 'oni' then 'neutral'
      end
      from rows where method = 'pacific'
    ),
    'skill_pct', (select max(past_hit_pct) from rows where method <> 'summary' and usable),
    'chance_pct', (select max(chance_hit_pct) from rows where method <> 'summary' and usable)
  ) end
$$;

revoke all on function public.public_seasonal_outlook() from public;
grant execute on function public.public_seasonal_outlook() to anon, authenticated;
