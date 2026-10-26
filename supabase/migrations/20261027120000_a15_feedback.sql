-- A15: ratings, feedback and the public comments page (spec sections 17 and 8; safety rules 5, 9).
--
-- THREE RULES THIS FILE EXISTS TO ENFORCE:
--
-- 1. **Sending is not publishing.** A comment reaches the public page only after an admin has
--    approved it, and only if the sender ticked that separate consent. `public_feedback()` is the
--    one path anon has to anybody else's row, and it returns a display name, the two notes and
--    the chips - never a district, a role, a device, a moment, a contact or a case id.
-- 2. **Nothing a sender can get wrong raises.** `submit_feedback` takes anything: no rating, no
--    chips, no words, a contact that is nonsense, the same device twice. Over the daily limit it
--    stores nothing and says so calmly, because a refused rating is not a refused SOS and must
--    not look like a broken app either.
-- 3. **A withdrawal always works.** A signed-in sender deletes their own row; an anonymous one
--    holds a key on their phone. Only the SHA-256 of that key is stored, like an SOS token, so a
--    database dump hands nobody the power to take down other people's comments.
--
-- Not stored anywhere: GPS, the tambon, or anything finer than the district the person chose.

-------------------------------------------------------------------------------
-- 1. The record
-------------------------------------------------------------------------------
create type public.feedback_kind as enum ('rating', 'problem', 'idea', 'other');
create type public.feedback_status as enum ('new', 'read', 'planned', 'done', 'wont_do', 'hidden');
create type public.feedback_public as enum ('not_requested', 'pending', 'approved', 'refused');

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind public.feedback_kind not null default 'rating',
  rating smallint check (rating between 1 and 5),
  -- The chosen chips, by their stable codes (lib/feedback.ts). A reworded chip keeps its count.
  liked text[] not null default '{}',
  liked_note text,
  improve text[] not null default '{}',
  improve_note text,
  -- Kept for the LINE path and for anything that arrives as one piece of text.
  message text,

  -- What the app knew by itself (spec 17). The district is the coarsest area that is any use;
  -- the tambon and GPS are deliberately absent, here and in every function below.
  screen text,
  locale text,
  app_version text,
  device_kind text,
  district_code text references public.districts (code) on delete set null,
  role_at_time text,
  moment text,
  -- A rating sent after a request carries its case for admins only, so a bad experience can be
  -- looked into. It never leaves the admin console.
  sos_id uuid references public.sos_requests (id) on delete set null,

  user_id uuid references auth.users (id) on delete set null,
  -- The install code of the phone that sent it: for the daily limit, never shown to anyone.
  device_id text,

  -- "You may contact me about this": consent with its purpose and the moment it was given (PDPA).
  contact_ok boolean not null default false,
  contact text,
  contact_purpose text,
  contact_consent_at timestamptz,

  -- Triage
  status public.feedback_status not null default 'new',
  admin_note text,
  handled_by uuid references public.profiles (user_id) on delete set null,
  handled_at timestamptz,
  change_ref text,

  -- The public page
  public_ok boolean not null default false,
  display_name text,
  public_status public.feedback_public not null default 'not_requested',
  approved_by uuid references public.profiles (user_id) on delete set null,
  approved_at timestamptz,
  -- sha256 of the key kept on the sender's phone; null for a row only its account can reach.
  withdraw_key_hash bytea,

  anonymised_at timestamptz
);

comment on table public.feedback is
  'Ratings and feedback (spec 17). Free text and contacts are admins-only; a comment is public only through public_feedback() after an admin approves it.';

create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_status_idx on public.feedback (status, created_at desc);
create index feedback_public_idx on public.feedback (public_status, created_at desc)
  where public_status = 'approved';
create index feedback_user_idx on public.feedback (user_id) where user_id is not null;
create index feedback_device_idx on public.feedback (device_id, created_at desc)
  where device_id is not null;
create index feedback_key_idx on public.feedback (withdraw_key_hash)
  where withdraw_key_hash is not null;

alter table public.feedback enable row level security;

-- A signed-in sender reads their own, published or not, and may delete it. Admins read all.
-- Nobody else selects anything: a visitor's only path is public_feedback() below.
create policy "feedback: own or admin reads" on public.feedback for select to authenticated
  using (public.is_admin() or (user_id is not null and user_id = (select auth.uid())));
create policy "feedback: own delete" on public.feedback for delete to authenticated
  using (user_id is not null and user_id = (select auth.uid()));
-- No insert and no update policy on purpose: every write goes through a function below, so the
-- rate limit, the consent and the access log cannot be stepped around.

-------------------------------------------------------------------------------
-- 2. What was done about each weak point, as the public page shows it
-------------------------------------------------------------------------------
-- The honest half of the page: beside each "what should be better" chip, in words, what Jaga did
-- about it. Written by an admin, read by everybody - so it carries no personal data at all.
create table public.feedback_outcomes (
  code text primary key,
  -- { "th": "...", "ms": "...", "en": "..." }; a missing language falls back to Thai.
  note jsonb not null default '{}',
  change_ref text,
  updated_by uuid references public.profiles (user_id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.feedback_outcomes enable row level security;
create policy "feedback_outcomes: anyone reads" on public.feedback_outcomes for select
  to anon, authenticated using (true);
create policy "feedback_outcomes: admins write" on public.feedback_outcomes for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-------------------------------------------------------------------------------
-- 3. The limits and the floor under a published figure
-------------------------------------------------------------------------------
insert into public.system_settings (key, value, note) values
  ('feedback_limit',
   '{"per_device_day": 3, "per_user_day": 3}'::jsonb,
   'Feedback one phone or one account may send per day. Over it nothing is stored and the person is told plainly (spec 17). Never applies to an SOS.'),
  ('feedback_public',
   '{"min_answers": 20, "comment_limit": 50}'::jsonb,
   'A published figure needs this many answers in the period (spec 17); below that the page says so instead of showing a number.')
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- 4. Sending one
-------------------------------------------------------------------------------
-- The chips, tidied: at most twenty, trimmed, lower case, no duplicates, no empties. The codes
-- themselves live in lib/feedback.ts and messages/*.json; the database only keeps them countable.
create function public.feedback_codes(p_codes text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce((
    select array_agg(c order by c) from (
      select distinct left(lower(btrim(x)), 40) as c
        from unnest(coalesce(p_codes, '{}'::text[])) as x
       where btrim(coalesce(x, '')) ~ '^[a-zA-Z_]{2,40}$'
       limit 20) q), '{}'::text[])
$$;
grant execute on function public.feedback_codes(text[]) to anon, authenticated;

create function public.feedback_key_hash(p_key text) returns bytea
language sql immutable set search_path = '' as $$
  select case when p_key is null or char_length(p_key) < 20 then null
              else extensions.digest(p_key, 'sha256') end
$$;
revoke execute on function public.feedback_key_hash(text) from public, anon, authenticated;

-- Everything a sender can get wrong is taken and tidied, never refused (rule 2 at the top).
-- `limited` true means the daily limit was reached: nothing was stored, and the screen says so.
create function public.submit_feedback(
  p_rating smallint default null,
  p_liked text[] default '{}',
  p_liked_note text default null,
  p_improve text[] default '{}',
  p_improve_note text default null,
  p_message text default null,
  p_screen text default null,
  p_locale text default null,
  p_app_version text default null,
  p_device_kind text default null,
  p_district text default null,
  p_moment text default null,
  p_sos uuid default null,
  p_device_id text default null,
  p_contact_ok boolean default false,
  p_contact text default null,
  p_public_ok boolean default false,
  p_display_name text default null
) returns table (feedback_id uuid, withdraw_key text, limited boolean)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_device text := nullif(left(coalesce(p_device_id, ''), 100), '');
  v_rating smallint := case when p_rating between 1 and 5 then p_rating end;
  v_liked text[] := public.feedback_codes(p_liked);
  v_improve text[] := public.feedback_codes(p_improve);
  v_liked_note text := nullif(left(btrim(coalesce(p_liked_note, '')), 2000), '');
  v_improve_note text := nullif(left(btrim(coalesce(p_improve_note, '')), 2000), '');
  v_message text := nullif(left(btrim(coalesce(p_message, '')), 2000), '');
  v_contact text := nullif(left(btrim(coalesce(p_contact, '')), 200), '');
  v_name text := nullif(left(btrim(coalesce(p_display_name, '')), 40), '');
  v_district text;
  v_locale text := case when p_locale in ('th', 'ms', 'en') then p_locale end;
  v_role text;
  v_sos uuid;
  v_key text;
  v_words boolean;
  v_recent integer;
  v_id uuid;
begin
  v_words := coalesce(v_liked_note, v_improve_note, v_message) is not null;
  -- Nothing at all to store: say so without raising, so a stray tap cannot look like a failure.
  if v_rating is null and v_liked = '{}'::text[] and v_improve = '{}'::text[] and not v_words then
    return query select null::uuid, null::text, false;
    return;
  end if;

  -- Two limits, because they stop different things: one phone sending all evening, and one
  -- account doing it from several phones.
  if v_device is not null then
    select count(*) into v_recent from public.feedback f
     where f.device_id = v_device and f.created_at > now() - interval '1 day';
    if v_recent >= public.setting_int('feedback_limit', 'per_device_day', 3) then
      return query select null::uuid, null::text, true;
      return;
    end if;
  end if;
  if uid is not null then
    select count(*) into v_recent from public.feedback f
     where f.user_id = uid and f.created_at > now() - interval '1 day';
    if v_recent >= public.setting_int('feedback_limit', 'per_user_day', 3) then
      return query select null::uuid, null::text, true;
      return;
    end if;
  end if;

  -- An unknown district is dropped rather than refused, and nothing finer is ever accepted.
  select d.code into v_district from public.districts d
   where d.code = nullif(btrim(coalesce(p_district, '')), '');
  if uid is not null then
    select p.role::text into v_role from public.profiles p where p.user_id = uid;
  end if;
  v_role := coalesce(nullif(left(btrim(coalesce(v_role, '')), 40), ''),
                     case when uid is null then 'visitor' end);
  -- The case only travels with the rating if it really is this sender's own.
  if p_sos is not null then
    select s.id into v_sos from public.sos_requests s
     where s.id = p_sos
       and ((uid is not null and s.requester_id = uid)
            or (v_device is not null and s.device_id = v_device));
  end if;

  -- A key only where it can be used: an anonymous comment the sender asked to publish.
  if uid is null and coalesce(p_public_ok, false) and v_words then
    v_key := encode(extensions.gen_random_bytes(24), 'hex');
  end if;

  insert into public.feedback (
    kind, rating, liked, liked_note, improve, improve_note, message,
    screen, locale, app_version, device_kind, district_code, role_at_time, moment, sos_id,
    user_id, device_id,
    contact_ok, contact, contact_purpose, contact_consent_at,
    public_ok, display_name, public_status, withdraw_key_hash)
  values (
    case when v_improve <> '{}'::text[] or v_improve_note is not null
         then 'problem'::public.feedback_kind
         when v_rating is not null then 'rating'::public.feedback_kind
         else 'other'::public.feedback_kind end,
    v_rating, v_liked, v_liked_note, v_improve, v_improve_note, v_message,
    nullif(left(btrim(coalesce(p_screen, '')), 120), ''), v_locale,
    nullif(left(btrim(coalesce(p_app_version, '')), 40), ''),
    case when p_device_kind in ('phone', 'tablet', 'desktop', 'other') then p_device_kind end,
    v_district, v_role, nullif(left(btrim(coalesce(p_moment, '')), 40), ''), v_sos,
    uid, v_device,
    -- A contact is stored only with the tick, and the tick is worth nothing without a contact.
    coalesce(p_contact_ok, false) and v_contact is not null,
    case when coalesce(p_contact_ok, false) then v_contact end,
    case when coalesce(p_contact_ok, false) and v_contact is not null
         then 'reply about this feedback' end,
    case when coalesce(p_contact_ok, false) and v_contact is not null then now() end,
    coalesce(p_public_ok, false),
    case when coalesce(p_public_ok, false) then v_name end,
    -- Only a comment with words in it can wait for approval; a bare rating has nothing to show.
    case when coalesce(p_public_ok, false) and v_words
         then 'pending'::public.feedback_public else 'not_requested'::public.feedback_public end,
    public.feedback_key_hash(v_key))
  returning id into v_id;

  return query select v_id, v_key, false;
end $$;
grant execute on function public.submit_feedback(smallint, text[], text, text[], text, text, text,
  text, text, text, text, text, uuid, text, boolean, text, boolean, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 5. Taking it back
-------------------------------------------------------------------------------
-- A signed-in sender's own row goes by the delete policy above; this is for the anonymous one,
-- holding the key their phone kept. Deleting, not hiding: the person asked for it to be gone.
create function public.withdraw_feedback(p_id uuid, p_key text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  f public.feedback;
begin
  select * into f from public.feedback where id = p_id;
  if not found then return false; end if;
  if not ((uid is not null and f.user_id = uid)
          or (f.withdraw_key_hash is not null and p_key is not null
              and f.withdraw_key_hash = public.feedback_key_hash(p_key))) then
    raise exception 'Not your feedback' using errcode = 'insufficient_privilege';
  end if;
  delete from public.feedback where id = p_id;
  -- Logged without the words: who took something down and when is a record worth keeping.
  perform public.log_access('feedback_withdrawn', 'feedback', p_id::text, jsonb_build_object(
    'was_public', f.public_status = 'approved', 'by', case when uid is null then 'key' else 'account' end));
  return true;
end $$;
grant execute on function public.withdraw_feedback(uuid, text) to anon, authenticated;

-- Whether a key still stands for a row, so the sender's own phone can show "take it down" and
-- nothing else. It answers about one row the caller already names, and says nothing about it.
create function public.feedback_mine(p_id uuid, p_key text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  f public.feedback;
begin
  select * into f from public.feedback where id = p_id;
  if not found then return null; end if;
  if not ((uid is not null and f.user_id = uid)
          or (f.withdraw_key_hash is not null and p_key is not null
              and f.withdraw_key_hash = public.feedback_key_hash(p_key))) then
    return null;
  end if;
  return jsonb_build_object(
    'id', f.id, 'createdAt', f.created_at, 'rating', f.rating,
    'liked', f.liked, 'likedNote', f.liked_note,
    'improve', f.improve, 'improveNote', f.improve_note,
    'publicStatus', f.public_status, 'displayName', f.display_name);
end $$;
grant execute on function public.feedback_mine(uuid, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 6. The public page: the approved comments
-------------------------------------------------------------------------------
-- The only path a visitor has to anybody else's row, and it carries four things: the display name
-- the sender chose (null means anonymous), the two notes, and the chips. No district, no role, no
-- device, no language, no contact, no case, and not even the exact moment - the month only, since
-- "the finest grain published is the whole service area, by month" (spec 17).
create function public.public_feedback(p_limit integer default 50)
returns table (
  id uuid,
  month text,
  display_name text,
  rating smallint,
  liked text[],
  liked_note text,
  improve text[],
  improve_note text
)
language sql stable security definer set search_path = '' as $$
  select f.id,
         to_char(f.created_at at time zone 'Asia/Bangkok', 'YYYY-MM'),
         f.display_name, f.rating,
         f.liked, f.liked_note, f.improve, f.improve_note
    from public.feedback f
   where f.public_status = 'approved' and f.public_ok
   order by f.approved_at desc nulls last, f.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1),
               public.setting_int('feedback_public', 'comment_limit', 50))
$$;
grant execute on function public.public_feedback(integer) to anon, authenticated;

-------------------------------------------------------------------------------
-- 7. The public page: Jaga's own figures, the unflattering ones with the rest
-------------------------------------------------------------------------------
-- A period with fewer than `min_answers` answers publishes no number at all (spec 17): with ten
-- answers an average is a mood, not a measurement, and a chip count of two names nothing. The
-- page then says how many answers it is still short of, which is itself honest.
--
-- `improve` carries what was done about each weak point, from feedback_outcomes - the half of
-- the page that makes it a work list rather than a star rating.
create function public.public_feedback_figures(p_months integer default 12) returns jsonb
language sql stable security definer set search_path = '' as $$
  with settings as (
    select public.setting_int('feedback_public', 'min_answers', 20) as floor
  ), since as (
    select date_trunc('month', (now() at time zone 'Asia/Bangkok'))
           - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 60) - 1) as from_month
  ), rows as (
    select f.*, to_char(f.created_at at time zone 'Asia/Bangkok', 'YYYY-MM') as month
      from public.feedback f, since
     where f.status <> 'hidden'
       and (f.created_at at time zone 'Asia/Bangkok') >= since.from_month
  ), period as (
    select count(*) as answers, count(rating) as rated, avg(rating) as average from rows
  ), by_month as (
    select month, count(*) as answers, count(rating) as rated, avg(rating) as average
      from rows group by month
  ), liked as (
    select c as code, count(*) as n from rows, unnest(rows.liked) as c group by c
  ), improve as (
    select c as code, count(*) as n from rows, unnest(rows.improve) as c group by c
  )
  select jsonb_build_object(
    'minAnswers', (select floor from settings),
    'answers', (select answers from period),
    'rated', (select rated from period),
    'enough', (select answers >= (select floor from settings) from period),
    'average', (select case when answers >= (select floor from settings) and rated > 0
                            then round(average::numeric, 1) end from period),
    'months', coalesce((select jsonb_agg(jsonb_build_object(
        'month', month,
        'answers', answers,
        'enough', answers >= (select floor from settings),
        'average', case when answers >= (select floor from settings) and rated > 0
                        then round(average::numeric, 1) end)
        order by month) from by_month), '[]'::jsonb),
    'liked', case when (select answers >= (select floor from settings) from period)
      then coalesce((select jsonb_agg(jsonb_build_object('code', code, 'count', n)
                                      order by n desc, code) from liked), '[]'::jsonb)
      else '[]'::jsonb end,
    'improve', case when (select answers >= (select floor from settings) from period)
      then coalesce((select jsonb_agg(jsonb_build_object(
             'code', i.code, 'count', i.n,
             'done', o.note, 'changeRef', o.change_ref) order by i.n desc, i.code)
             from improve i left join public.feedback_outcomes o on o.code = i.code),
           '[]'::jsonb)
      else '[]'::jsonb end
  )
$$;
grant execute on function public.public_feedback_figures(integer) to anon, authenticated;

-------------------------------------------------------------------------------
-- 8. The admin console
-------------------------------------------------------------------------------
-- Everything but the contact: that is shown only through feedback_contact(), on a logged tap.
create function public.admin_feedback(
  p_status public.feedback_status default null,
  p_public public.feedback_public default null,
  p_rating smallint default null,
  p_locale text default null,
  p_screen text default null,
  p_role text default null,
  p_days integer default 365,
  p_limit integer default 200
) returns table (
  id uuid,
  created_at timestamptz,
  kind public.feedback_kind,
  rating smallint,
  liked text[],
  liked_note text,
  improve text[],
  improve_note text,
  message text,
  screen text,
  locale text,
  app_version text,
  device_kind text,
  district_code text,
  district_th text,
  district_en text,
  role_at_time text,
  moment text,
  sos_id uuid,
  signed_in boolean,
  has_contact boolean,
  status public.feedback_status,
  admin_note text,
  change_ref text,
  handled_at timestamptz,
  public_ok boolean,
  display_name text,
  public_status public.feedback_public,
  approved_at timestamptz,
  anonymised_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select f.id, f.created_at, f.kind, f.rating, f.liked, f.liked_note, f.improve, f.improve_note,
         f.message, f.screen, f.locale, f.app_version, f.device_kind,
         f.district_code, d.name_th, d.name_en,
         f.role_at_time, f.moment, f.sos_id,
         f.user_id is not null, f.contact is not null,
         f.status, f.admin_note, f.change_ref, f.handled_at,
         f.public_ok, f.display_name, f.public_status, f.approved_at, f.anonymised_at
    from public.feedback f
    left join public.districts d on d.code = f.district_code
   where (p_status is null or f.status = p_status)
     and (p_public is null or f.public_status = p_public)
     and (p_rating is null or f.rating = p_rating)
     and (p_locale is null or f.locale = p_locale)
     and (p_screen is null or f.screen = p_screen)
     and (p_role is null or f.role_at_time = p_role)
     and f.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 365), 1), 1825))
   order by f.created_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;
revoke execute on function public.admin_feedback(public.feedback_status, public.feedback_public,
  smallint, text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_feedback(public.feedback_status, public.feedback_public,
  smallint, text, text, text, integer, integer) to authenticated;

-- The contact the sender agreed to be reached on. A phone number, a LINE id or an email is
-- personal data under safety rule 5, so this is the only way to it and every tap is logged.
create function public.feedback_contact(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_contact text;
  v_ok boolean;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  select f.contact, f.contact_ok into v_contact, v_ok from public.feedback f where f.id = p_id;
  if not found then return null; end if;
  perform public.log_access('reveal_feedback_contact', 'feedback', p_id::text,
    jsonb_build_object('had_contact', v_contact is not null, 'consented', coalesce(v_ok, false)));
  return case when coalesce(v_ok, false) then v_contact end;
end $$;
revoke execute on function public.feedback_contact(uuid) from public, anon;
grant execute on function public.feedback_contact(uuid) to authenticated;

-- Triage. Closing an item clears the contact there and then, as spec 17 requires, so a note
-- somebody left in April is not still holding their phone number in December.
create function public.admin_feedback_triage(
  p_id uuid,
  p_status public.feedback_status,
  p_note text default null,
  p_change_ref text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_closed boolean;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  v_closed := p_status in ('done', 'wont_do', 'hidden');
  update public.feedback f set
    status = p_status,
    admin_note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''), f.admin_note),
    change_ref = coalesce(nullif(left(btrim(coalesce(p_change_ref, '')), 200), ''), f.change_ref),
    handled_by = uid,
    handled_at = now(),
    contact = case when v_closed then null else f.contact end,
    contact_ok = case when v_closed then false else f.contact_ok end
   where f.id = p_id;
  if not found then
    raise exception 'No such feedback' using errcode = 'no_data_found';
  end if;
  perform public.log_access('feedback_triaged', 'feedback', p_id::text,
    jsonb_build_object('status', p_status, 'contact_cleared', v_closed));
end $$;
revoke execute on function public.admin_feedback_triage(uuid, public.feedback_status, text, text)
  from public, anon;
grant execute on function public.admin_feedback_triage(uuid, public.feedback_status, text, text)
  to authenticated;

-- Approving, refusing, or taking an approved one back off the page. Nothing is ever edited: the
-- words on the page are the sender's own or they are not there (spec 17, safety rule 6's
-- discipline for report photos).
--
-- A row whose sender never asked for it to be published cannot be approved at all, whatever an
-- admin presses: the consent is the sender's, not the console's.
create function public.admin_feedback_publish(p_id uuid, p_to public.feedback_public)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  f public.feedback;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  select * into f from public.feedback where id = p_id;
  if not found then
    raise exception 'No such feedback' using errcode = 'no_data_found';
  end if;
  if p_to = 'approved' and not f.public_ok then
    raise exception 'This sender did not agree to it being shown' using errcode = 'check_violation';
  end if;
  if p_to = 'not_requested' then
    raise exception 'A consent cannot be given on the sender''s behalf' using errcode = 'check_violation';
  end if;
  update public.feedback set
    public_status = p_to,
    approved_by = case when p_to = 'approved' then uid else approved_by end,
    approved_at = case when p_to = 'approved' then now() else approved_at end
   where id = p_id;
  perform public.log_access('feedback_publish', 'feedback', p_id::text,
    jsonb_build_object('to', p_to, 'from', f.public_status));
end $$;
revoke execute on function public.admin_feedback_publish(uuid, public.feedback_public)
  from public, anon;
grant execute on function public.admin_feedback_publish(uuid, public.feedback_public)
  to authenticated;

-- What an admin writes beside a weak point: what was done about it, in all three languages, and
-- the decision entry or commit it came from. Shown on the public page beside the count.
create function public.admin_feedback_outcome(
  p_code text,
  p_th text default null,
  p_ms text default null,
  p_en text default null,
  p_change_ref text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_code text := nullif(left(lower(btrim(coalesce(p_code, ''))), 40), '');
  v_note jsonb := '{}'::jsonb;
  v_add jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  if v_code is null or v_code !~ '^[a-z_]{2,40}$' then
    raise exception 'Not a chip code' using errcode = 'invalid_parameter_value';
  end if;
  v_add := jsonb_strip_nulls(jsonb_build_object(
    'th', nullif(left(btrim(coalesce(p_th, '')), 500), ''),
    'ms', nullif(left(btrim(coalesce(p_ms, '')), 500), ''),
    'en', nullif(left(btrim(coalesce(p_en, '')), 500), '')));
  v_note := v_add;
  insert into public.feedback_outcomes (code, note, change_ref, updated_by, updated_at)
  values (v_code, v_note, nullif(left(btrim(coalesce(p_change_ref, '')), 200), ''), uid, now())
  on conflict (code) do update set
    note = excluded.note, change_ref = excluded.change_ref,
    updated_by = excluded.updated_by, updated_at = now();
  perform public.log_access('feedback_outcome', 'feedback_outcomes', v_code,
    jsonb_build_object('languages', (select count(*) from jsonb_object_keys(v_note))));
end $$;
revoke execute on function public.admin_feedback_outcome(text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_feedback_outcome(text, text, text, text, text)
  to authenticated;

-- The trends the admin page draws: the average by month, by screen and by language, and the
-- share of each chip. Admins see every period, with no floor under it - a figure they can act on
-- is not a figure they publish, and the count is beside it so a small one reads as small.
create function public.admin_feedback_trends(p_months integer default 12) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  with since as (
    select date_trunc('month', (now() at time zone 'Asia/Bangkok'))
           - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 60) - 1) as from_month
  ), rows as (
    select f.*, to_char(f.created_at at time zone 'Asia/Bangkok', 'YYYY-MM') as month
      from public.feedback f, since
     where (f.created_at at time zone 'Asia/Bangkok') >= since.from_month
  )
  select jsonb_build_object(
    'answers', (select count(*) from rows),
    'rated', (select count(rating) from rows),
    'average', (select round(avg(rating)::numeric, 2) from rows),
    'byMonth', coalesce((select jsonb_agg(x order by x ->> 'month') from (
        select jsonb_build_object('month', month, 'answers', count(*), 'rated', count(rating),
                                  'average', round(avg(rating)::numeric, 2)) as x
          from rows group by month) q), '[]'::jsonb),
    'byScreen', coalesce((select jsonb_agg(x order by (x ->> 'average')::numeric nulls last) from (
        select jsonb_build_object('screen', coalesce(screen, 'unknown'), 'answers', count(*),
                                  'rated', count(rating), 'average', round(avg(rating)::numeric, 2)) as x
          from rows group by coalesce(screen, 'unknown')) q), '[]'::jsonb),
    'byLocale', coalesce((select jsonb_agg(x order by x ->> 'locale') from (
        select jsonb_build_object('locale', coalesce(locale, 'unknown'), 'answers', count(*),
                                  'rated', count(rating), 'average', round(avg(rating)::numeric, 2)) as x
          from rows group by coalesce(locale, 'unknown')) q), '[]'::jsonb),
    'byRole', coalesce((select jsonb_agg(x order by x ->> 'role') from (
        select jsonb_build_object('role', coalesce(role_at_time, 'unknown'), 'answers', count(*),
                                  'average', round(avg(rating)::numeric, 2)) as x
          from rows group by coalesce(role_at_time, 'unknown')) q), '[]'::jsonb),
    'liked', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'count', n)
                                        order by n desc, code) from (
        select c as code, count(*) as n from rows, unnest(rows.liked) as c group by c) q), '[]'::jsonb),
    'improve', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'count', n,
                                            'done', done, 'changeRef', change_ref)
                                        order by n desc, code) from (
        select c as code, count(*) as n, max(o.note) as done, max(o.change_ref) as change_ref
          from rows, unnest(rows.improve) as c
          left join public.feedback_outcomes o on o.code = c
         group by c) q), '[]'::jsonb),
    'byStatus', coalesce((select jsonb_object_agg(status, n) from (
        select status::text as status, count(*) as n from rows group by status) q), '{}'::jsonb),
    'waitingPublic', (select count(*) from rows where public_status = 'pending')
  ) into v;
  return v;
end $$;
revoke execute on function public.admin_feedback_trends(integer) from public, anon;
grant execute on function public.admin_feedback_trends(integer) to authenticated;

-- The CSV export, without a contact in it (spec 17 item 7). One JSON value rather than a table,
-- the way admin_export does it, so the API does not cut the rows off at a thousand in silence.
create function public.admin_feedback_export(p_days integer default 365) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
  v_days integer := least(greatest(coalesce(p_days, 365), 1), 1825);
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'created_at', f.created_at, 'kind', f.kind, 'rating', f.rating,
    'liked', array_to_string(f.liked, ' '), 'liked_note', f.liked_note,
    'improve', array_to_string(f.improve, ' '), 'improve_note', f.improve_note,
    'message', f.message, 'screen', f.screen, 'locale', f.locale,
    'app_version', f.app_version, 'device_kind', f.device_kind,
    'district_code', f.district_code, 'role_at_time', f.role_at_time, 'moment', f.moment,
    'status', f.status, 'admin_note', f.admin_note, 'change_ref', f.change_ref,
    'public_status', f.public_status, 'display_name', f.display_name,
    -- Deliberately not here: contact, device_id, user_id, sos_id.
    'had_contact', f.contact is not null) order by f.created_at desc), '[]'::jsonb)
    into v
    from public.feedback f
   where f.created_at > now() - make_interval(days => v_days);
  perform public.log_access('feedback_export', 'feedback', 'csv',
    jsonb_build_object('days', v_days, 'rows', jsonb_array_length(v)));
  return v;
end $$;
revoke execute on function public.admin_feedback_export(integer) from public, anon;
grant execute on function public.admin_feedback_export(integer) to authenticated;

-------------------------------------------------------------------------------
-- 9. Retention: the nightly clock (spec 17)
-------------------------------------------------------------------------------
-- Two jobs in one pass:
--
--  * **Contacts on a closed item.** A contact exists to answer somebody; once the item is done,
--    won't-do or hidden, the reason is gone, so the contact goes. The triage function clears it
--    at the moment of closing; this is the backstop for rows closed before this migration and
--    for anything closed by hand.
--  * **Twelve months.** Everything around an answer is anonymised: the account, the device, the
--    district, the role, the kind of phone, the moment it was asked and the case it followed.
--    What is kept is what is already public or purely a figure - the rating, the chips, the
--    month, the screen and the language. A comment that was never published loses its words too.
--    An approved one keeps the display name and the words, because those are what the sender
--    consented to and what is already on the page, and it keeps its withdrawal key, because a
--    published comment must stay withdrawable for as long as it is published. The account link
--    goes even then, so from a year on the phone's key is the only way back to it.
create function public.feedback_retention() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_done integer := 0;
  v_n integer;
begin
  update public.feedback set contact = null, contact_ok = false, contact_purpose = null,
                             contact_consent_at = null
   where contact is not null and status in ('done', 'wont_do', 'hidden');
  get diagnostics v_n = row_count;
  v_done := v_done + v_n;

  update public.feedback f set
    user_id = null,
    device_id = null,
    district_code = null,
    role_at_time = null,
    device_kind = null,
    app_version = null,
    moment = null,
    sos_id = null,
    contact = null,
    contact_ok = false,
    contact_purpose = null,
    contact_consent_at = null,
    message = case when f.public_status = 'approved' then f.message end,
    liked_note = case when f.public_status = 'approved' then f.liked_note end,
    improve_note = case when f.public_status = 'approved' then f.improve_note end,
    display_name = case when f.public_status = 'approved' then f.display_name end,
    withdraw_key_hash = case when f.public_status = 'approved' then f.withdraw_key_hash end,
    anonymised_at = now()
   where f.anonymised_at is null and f.created_at < now() - interval '12 months';
  get diagnostics v_n = row_count;
  v_done := v_done + v_n;
  return v_done;
end $$;
revoke execute on function public.feedback_retention() from public, anon, authenticated;

select cron.schedule('jaga-feedback-retention', '23 18 * * *', 'select public.feedback_retention()');
