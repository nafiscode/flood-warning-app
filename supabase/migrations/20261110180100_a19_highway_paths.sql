-- A19: where a main highway may be holding flood water back, in the authority console.
--
-- docs/prompts.md A19; science plan Module 8 part 2; pipeline/highway_paths/METHODS.md.
--
-- Module 8 part 2 has been built since 15 October 2026 and its lists have sat on a laptop ever
-- since. This is how the two offices that can act on them get them: a page of their own in the
-- authority console. Not a document pack, and never in the public app.
--
-- What the rows are. The radar record (nine flood seasons, 368 passes) was read on both sides of
-- every 500 m section of every main highway in the four provinces, together with the drainage
-- crossings that have no mapped bridge or culvert. A section where the side the water COMES FROM
-- is the wetter one is the anomaly: that is what a dam does. 4,366 sections, of which 70 are
-- "look here first" and 165 "worth a look"; neighbouring flagged sections of one road are joined
-- into a stretch, because one place to look at is easier to act on than three neighbours in a list.
--
-- What it is not, and this governs every line below (safety rule 8):
--
--   * It is not evidence that a road holds water back. The radar sees extent, not depth; a wetter
--     side can be a paddy, a fish pond or a natural low; "no mapped opening" nearly always means
--     "not mapped", because OpenStreetMap here holds 102 culverts for 2,099 km of main road.
--   * It is nobody's alert. Nothing in it feeds an alert level, a suggestion, a notification or
--     the public map. It is advice for an engineer, to be checked on imagery and on the ground.
--   * It is not personal data, so no reveal logging is needed. The page view is written to
--     `audit_log` like the other authority views.
--
-- Who may read it (A19 item 6, and 20261110180000 which had to come first): a verified unit that
-- holds the `planning` capability, for the provinces its coverage falls in - province scope, not
-- tambon, because an office works on a whole road. Admins read all four. Never anon, never a
-- resident, never a rescue-only unit. The read is granted by naming `planning` here, never by
-- leaning on coverage alone: `covers_tambon()` deliberately turns a planning office away.

-------------------------------------------------------------------------------
-- 1. Who is a planning office here.
--
-- Deliberately NOT `covers_tambon()`. That function means "a team in the field covers this
-- tambon", and since 20261110180000 it is false for an office. This asks a different question:
-- does this account speak for a verified planning unit whose coverage reaches into this province.
--
-- The unit's people count as the unit, as everywhere else (24 Oct): the registrant and the active
-- dispatchers. A `field` member is not included - there is no field work in a list of culverts to
-- look at, and the narrower default is the right one (safety rule 5).
-------------------------------------------------------------------------------
create function public.planning_covers_province(p_province text) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1
    from public.authority_coverage c
    join public.authority_units u on u.id = c.unit_id
    where u.status = 'verified'
      and u.capabilities && array['planning']::public.authority_capability[]
      and left(c.tambon, 2) = p_province
      and (u.user_id = (select auth.uid()) or public.is_my_unit(u.id))
  )
$fn$;
revoke execute on function public.planning_covers_province(text) from public, anon;
grant execute on function public.planning_covers_province(text) to authenticated;

comment on function public.planning_covers_province(text) is
  'True when the caller speaks for a verified planning unit covering part of this province. The '
  'A19 highway-paths read, and nothing else: it grants no case, no phone and no household.';

-- The provinces this account may open the page for, in code order. Empty for everybody else.
create function public.my_planning_provinces()
returns table (province_code text, name_th text, name_en text)
language sql stable security definer set search_path = '' as $fn$
  select p.code, p.name_th, p.name_en
    from public.provinces p
   where public.is_admin() or public.planning_covers_province(p.code)
   order by p.code
$fn$;
revoke execute on function public.my_planning_provinces() from public, anon;
grant execute on function public.my_planning_provinces() to authenticated;

-------------------------------------------------------------------------------
-- 2. The sections: one row per 500 m of main road.
--
-- Everything the page shows and everything the download carries, so that a reader can judge the
-- figure as well as read the sentence. The reasons are kept as STRUCTURED fields, never as the
-- pipeline's English prose: the page builds its own wording from messages/*.json, Thai first
-- (A19 item 4). The prose is in the CSV download for a GIS, where English is the lingua franca.
-------------------------------------------------------------------------------
create type public.highway_path_class as enum ('look_first', 'worth_a_look', 'no_sign', 'not_seen');
create type public.highway_path_side as enum ('left', 'right');

create table public.highway_sections (
  id text primary key check (id ~ '^S[0-9]{5}$'),
  -- Which run of the pipeline these rows are. A reload replaces every row of the previous run in
  -- one transaction (the loader), so one run is in the table at a time; both are shown on the
  -- page, because a reader must know how old the radar record behind a list is.
  run_id text not null,
  run_date date not null,

  -- Where it is. The line is the section itself; the point is its middle, for a map link.
  geom extensions.geometry(LineString, 4326) not null,
  mid extensions.geometry(Point, 4326) not null,
  province_code text not null references public.provinces (code),
  district_code text not null references public.districts (code),
  tambon_code text not null references public.tambons (code),

  -- What road. The number and name are OpenStreetMap's, and 6 % of sections have no number.
  road_kind text not null check (road_kind in ('motorway', 'trunk', 'primary',
                                               'motorway_link', 'trunk_link', 'primary_link')),
  road_ref text,
  road_name_th text,
  road_name_en text,
  osm_way bigint,
  length_m integer not null check (length_m > 0),
  bridge_m integer not null default 0,
  -- The other carriageway of a divided highway, scored on the same corridor (METHODS rule 3).
  twin_section text,
  -- Which line of joined ways, and where along it: how neighbours are found.
  chain integer not null,
  section_index integer not null,

  -- The verdict.
  class public.highway_path_class not null,
  -- 'not_seen' means the radar saw both sides in no season and no pass, so there is nothing to
  -- score; every other class has one. The two always agree, and saying so here keeps the page's
  -- "the radar has not seen this stretch" from ever being drawn as a score of zero.
  score numeric(4, 3) check (score >= 0 and score <= 1),
  constraint highway_sections_score_for_class
    check ((class = 'not_seen') = (score is null)),
  score_parts jsonb not null default '{}',
  stretch text,

  -- Reason: which side the water comes from, and how sure that is (METHODS rule 4).
  upstream_side public.highway_path_side,
  -- 'unclear' is a verdict of its own, not a missing value: no rule decided which side the water
  -- comes from, and the page says so (460 of 4,366 sections).
  upstream_by text not null check (upstream_by in ('d8', 'crossing', 'dem', 'unclear')),
  upstream_d8 public.highway_path_side,
  upstream_dem public.highway_path_side,
  d8_dem_agree boolean,
  dem_left_m numeric(7, 2),
  dem_right_m numeric(7, 2),

  -- Reason: the flood record on each side (METHODS rule 5).
  asymmetry numeric(5, 3),
  seasons_seen integer not null default 0,
  seasons_up_wetter integer not null default 0,
  seasons_down_wetter integer not null default 0,
  persistence numeric(6, 4),
  pass_flood_share_up numeric(6, 4),
  pass_flood_share_down numeric(6, 4),
  passes_seen integer not null default 0,
  passes_flooded_up integer not null default 0,
  passes_flooded_down integer not null default 0,
  cells_left integer,
  cells_right integer,

  -- Reason: the largest drainage crossing in the section, and the nearest mapped opening
  -- (METHODS rules 6 and 7). `crossing_opening` null means none was found within a kilometre.
  crossings integer not null default 0,
  crossing_km2 numeric(9, 2),
  crossing_from public.highway_path_side,
  crossing_point extensions.geometry(Point, 4326),
  crossing_opening text check (crossing_opening in ('bridge', 'culvert', 'waterway')),
  crossing_opening_m integer,
  bridges integer not null default 0,
  culverts integer not null default 0,
  waterway_crossings integer not null default 0,

  loaded_at timestamptz not null default now()
);
create index highway_sections_province_idx on public.highway_sections (province_code, class);
create index highway_sections_stretch_idx on public.highway_sections (stretch);
create index highway_sections_geom_idx on public.highway_sections using gist (geom);

comment on table public.highway_sections is
  'Module 8 part 2: 500 m sections of main highway with the flood record on each side. Advice for '
  'the highway and irrigation offices, checked on the ground before it means anything. Never an '
  'alert, never public, no personal data.';

-------------------------------------------------------------------------------
-- 3. The stretches: neighbouring flagged sections of one road, told by the best of them.
--
-- `listed` is the pipeline's own rule that the other carriageway of a stretch already in the list
-- is left out of it (METHODS rule 10): both carriageways keep their rows, one of them is shown.
-------------------------------------------------------------------------------
create table public.highway_stretches (
  id text primary key check (id ~ '^R[0-9]{5}$'),
  run_id text not null,
  run_date date not null,
  province_code text not null references public.provinces (code),
  class public.highway_path_class not null check (class in ('look_first', 'worth_a_look')),
  score numeric(4, 3) not null,
  km numeric(5, 1) not null,
  best_section text not null,
  sections text[] not null,
  twin_sections text[] not null default '{}',
  listed boolean not null default true,
  rank integer,
  loaded_at timestamptz not null default now()
);
create index highway_stretches_province_idx
  on public.highway_stretches (province_code, listed, rank);

comment on table public.highway_stretches is
  'A19: neighbouring flagged highway sections joined into one place to look at. Rebuilt whole by '
  'the pipeline loader; the offices'' notes are keyed on the id and survive a reload.';

-------------------------------------------------------------------------------
-- 4. One note per stretch from the office that owns it (A19 item 5).
--
-- Their working record: what they found when they looked. It is keyed on the stretch id as TEXT
-- with no foreign key, on purpose. The pipeline's rows are replaced every time the radar is rerun
-- and a stretch id can disappear; the office's note is their work and must outlive it. A note
-- whose stretch is gone is still readable and is shown as such.
--
-- Written only through the function below, and only by that province's planning units.
-------------------------------------------------------------------------------
create type public.highway_note_status as enum (
  'not_looked', 'checked_imagery', 'checked_ground', 'opening_exists', 'work_planned', 'done');

create table public.highway_stretch_notes (
  stretch_id text not null check (stretch_id ~ '^R[0-9]{5}$'),
  unit_id uuid not null references public.authority_units (id) on delete cascade,
  province_code text not null references public.provinces (code),
  status public.highway_note_status not null default 'not_looked',
  note text check (note is null or length(note) <= 2000),
  updated_by uuid references public.profiles (user_id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (stretch_id, unit_id)
);
create index highway_stretch_notes_province_idx on public.highway_stretch_notes (province_code);

comment on table public.highway_stretch_notes is
  'A19: what a planning office found when it looked at a stretch. Theirs and the admins'', never '
  'public, and it survives a reload of the pipeline''s rows.';

-------------------------------------------------------------------------------
-- 5. Row-level security.
--
-- Three tables, one rule: an admin, or a planning office in that province. Nothing is writable
-- through a policy - the loader connects as the database owner and the one note goes through the
-- function in section 6.
-------------------------------------------------------------------------------
alter table public.highway_sections enable row level security;
alter table public.highway_stretches enable row level security;
alter table public.highway_stretch_notes enable row level security;

create policy "highway_sections: admins and that province's planning office"
  on public.highway_sections for select to authenticated
  using (public.is_admin() or public.planning_covers_province(province_code));

create policy "highway_stretches: admins and that province's planning office"
  on public.highway_stretches for select to authenticated
  using (public.is_admin() or public.planning_covers_province(province_code));

create policy "highway_stretch_notes: admins and that province's planning office"
  on public.highway_stretch_notes for select to authenticated
  using (public.is_admin() or public.planning_covers_province(province_code));

revoke insert, update, delete, truncate on public.highway_sections from anon, authenticated;
revoke insert, update, delete, truncate on public.highway_stretches from anon, authenticated;
revoke insert, update, delete, truncate on public.highway_stretch_notes from anon, authenticated;
grant select on public.highway_sections to authenticated;
grant select on public.highway_stretches to authenticated;
grant select on public.highway_stretch_notes to authenticated;

-------------------------------------------------------------------------------
-- 6. The office writes its note.
--
-- The unit is not an argument the caller chooses: it is looked up from the account and the
-- stretch's province, so one office can never write into another's record. Every write is in
-- `audit_log` under the person's own account.
-------------------------------------------------------------------------------
create function public.set_highway_stretch_note(
  p_stretch text, p_status public.highway_note_status, p_note text
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_province text;
  v_unit uuid;
begin
  select province_code into v_province
    from public.highway_stretches where id = p_stretch;
  if v_province is null then
    -- A note may be written against a stretch of the previous run (it is still on their screen
    -- until they reload), but never against an id that has never existed.
    select province_code into v_province
      from public.highway_stretch_notes where stretch_id = p_stretch limit 1;
  end if;
  if v_province is null then
    raise exception 'no such stretch' using errcode = 'no_data_found';
  end if;

  -- Which of the caller's units is writing. The planning unit covering that province; if an
  -- account somehow speaks for two, the one registered first, so the record is stable.
  select u.id into v_unit
    from public.authority_units u
    join public.authority_coverage c on c.unit_id = u.id
   where u.status = 'verified'
     and u.capabilities && array['planning']::public.authority_capability[]
     and left(c.tambon, 2) = v_province
     and (u.user_id = (select auth.uid()) or public.is_my_unit(u.id))
   order by u.created_at
   limit 1;
  if v_unit is null then
    raise exception 'Not allowed to write on this stretch' using errcode = 'insufficient_privilege';
  end if;

  if p_note is not null and length(p_note) > 2000 then
    raise exception 'that note is too long' using errcode = 'check_violation';
  end if;

  insert into public.highway_stretch_notes
              (stretch_id, unit_id, province_code, status, note, updated_by, updated_at)
       values (p_stretch, v_unit, v_province, p_status, nullif(btrim(p_note), ''),
               (select auth.uid()), now())
  on conflict (stretch_id, unit_id) do update
     set status = excluded.status, note = excluded.note,
         updated_by = excluded.updated_by, updated_at = now();

  insert into public.audit_log (actor, action, entity, entity_id, details)
    values ((select auth.uid()), 'highway_note_set', 'highway_stretches', p_stretch,
            jsonb_build_object('unit', v_unit, 'status', p_status,
                               'has_note', nullif(btrim(coalesce(p_note, '')), '') is not null));
end $fn$;
revoke all on function public.set_highway_stretch_note(text, public.highway_note_status, text)
  from public, anon;
grant execute on function public.set_highway_stretch_note(text, public.highway_note_status, text)
  to authenticated;

-------------------------------------------------------------------------------
-- 7. The page view, in the audit log.
--
-- A19 item 1: "the page view is written to `audit_log` like the other authority views". There is
-- no personal data here to reveal, so this is a record of who looked and at what, not a reveal.
-- A download is logged the same way with its own action, because that is a copy leaving Jaga.
-------------------------------------------------------------------------------
create function public.log_highway_paths_view(p_province text, p_download text default null)
returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if not (public.is_admin() or public.planning_covers_province(p_province)) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values ((select auth.uid()),
            case when p_download is null then 'highway_paths_viewed'
                 else 'highway_paths_downloaded' end,
            'provinces', p_province,
            case when p_download is null then '{}'::jsonb
                 else jsonb_build_object('format', p_download) end);
end $fn$;
revoke all on function public.log_highway_paths_view(text, text) from public, anon;
grant execute on function public.log_highway_paths_view(text, text) to authenticated;

-------------------------------------------------------------------------------
-- 8. What the map draws, what the list shows, and what the download carries.
--
-- The two exports are ONE jsonb value rather than a table, for the reason A15's export already
-- met: the API cuts a table at 1,000 rows without saying so, and Songkhla alone has 2,000
-- sections. A list that silently loses three quarters of a province is worse than no list.
--
-- All three ask the same question the policies ask, because a security-definer function does not
-- get to skip it. One province per call, never all four: the province is the scope of the whole
-- feature (A19 item 3, "the download carries only the unit's own province").
-------------------------------------------------------------------------------

-- The map layer: the line, the class, and just enough to answer a tap. Deliberately slim - a
-- planning office opens this at a desk, but Jaga is built for a cheap phone on slow 3G and every
-- figure lives in the list beside the map anyway.
create function public.highway_sections_map(p_province text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare
  out_json jsonb;
begin
  if not (public.is_admin() or public.planning_covers_province(p_province)) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select jsonb_build_object(
           'type', 'FeatureCollection',
           'features', coalesce(jsonb_agg(jsonb_build_object(
             'type', 'Feature',
             'id', s.id,
             'geometry', extensions.st_asgeojson(s.geom)::jsonb,
             'properties', jsonb_build_object(
               'id', s.id, 'class', s.class, 'stretch', s.stretch,
               'ref', s.road_ref, 'score', s.score))), '[]'::jsonb))
    into out_json
    from public.highway_sections s
   where s.province_code = p_province;
  return out_json;
end $fn$;
revoke all on function public.highway_sections_map(text) from public, anon;
grant execute on function public.highway_sections_map(text) to authenticated;

-- The download: every figure behind every section of that province, flat, for their own GIS. The
-- pipeline's own English sentence is NOT in it - the page writes the words from the reviewed
-- wording in messages/*.json (A19 item 4), and a spreadsheet carrying a second, unreviewed
-- phrasing of the same thing would be the one people ended up quoting.
create function public.highway_sections_export(p_province text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare
  out_json jsonb;
begin
  if not (public.is_admin() or public.planning_covers_province(p_province)) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.class, r.score desc nulls last, r.id),
                  '[]'::jsonb)
    into out_json
    from (
      select s.id, s.run_id, s.run_date, s.class::text as class, s.score, s.stretch,
             st.rank as stretch_rank, st.listed as stretch_listed,
             s.road_kind, s.road_ref, s.road_name_th, s.road_name_en, s.osm_way,
             s.province_code, p.name_en as province, s.district_code,
             d.name_th as district_th, d.name_en as district_en,
             s.tambon_code, t.name_th as tambon_th, t.name_en as tambon_en,
             s.length_m, s.bridge_m, s.twin_section,
             extensions.st_y(s.mid) as mid_lat, extensions.st_x(s.mid) as mid_lon,
             s.upstream_side::text as upstream_side, s.upstream_by,
             s.upstream_d8::text as upstream_d8, s.upstream_dem::text as upstream_dem,
             s.d8_dem_agree, s.dem_left_m, s.dem_right_m,
             s.asymmetry, s.seasons_seen, s.seasons_up_wetter, s.seasons_down_wetter,
             s.persistence, s.pass_flood_share_up, s.pass_flood_share_down,
             s.passes_seen, s.passes_flooded_up, s.passes_flooded_down,
             s.cells_left, s.cells_right,
             s.crossings, s.crossing_km2, s.crossing_from::text as crossing_from,
             extensions.st_y(s.crossing_point) as crossing_lat,
             extensions.st_x(s.crossing_point) as crossing_lon,
             s.crossing_opening, s.crossing_opening_m,
             s.bridges, s.culverts, s.waterway_crossings, s.score_parts,
             extensions.st_asgeojson(s.geom)::jsonb as geometry
        from public.highway_sections s
        left join public.highway_stretches st on st.id = s.stretch
        join public.provinces p on p.code = s.province_code
        join public.districts d on d.code = s.district_code
        join public.tambons t on t.code = s.tambon_code
       where s.province_code = p_province
    ) r;
  return out_json;
end $fn$;
revoke all on function public.highway_sections_export(text) from public, anon;
grant execute on function public.highway_sections_export(text) to authenticated;

-- The list the page is built around: that province's flagged stretches, best first, each told by
-- its best section, with the office's own note beside it. Small - 32 for Pattani, 48 for
-- Narathiwat - so this is the one read the page always makes, map or no map.
create function public.highway_stretch_board(p_province text)
returns table (
  stretch_id text, stretch_class public.highway_path_class, rank integer, score numeric,
  km numeric, sections integer, run_id text, run_date date,
  section_id text, road_kind text, road_ref text, road_name_th text, road_name_en text,
  district_th text, district_en text, tambon_th text, tambon_en text, tambon_code text,
  mid_lat double precision, mid_lon double precision,
  upstream_side public.highway_path_side, upstream_by text, d8_dem_agree boolean,
  asymmetry numeric, seasons_seen integer, seasons_up_wetter integer, seasons_down_wetter integer,
  persistence numeric, passes_seen integer, passes_flooded_up integer, passes_flooded_down integer,
  crossing_km2 numeric, crossing_from public.highway_path_side, crossing_opening text,
  crossing_opening_m integer, crossing_lat double precision, crossing_lon double precision,
  note_status public.highway_note_status, note text, note_at timestamptz, note_unit text
)
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not (public.is_admin() or public.planning_covers_province(p_province)) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
  select st.id, st.class, st.rank, st.score, st.km, cardinality(st.sections),
         st.run_id, st.run_date,
         s.id, s.road_kind, s.road_ref, s.road_name_th, s.road_name_en,
         d.name_th, d.name_en, t.name_th, t.name_en, s.tambon_code,
         extensions.st_y(s.mid), extensions.st_x(s.mid),
         s.upstream_side, s.upstream_by, s.d8_dem_agree,
         s.asymmetry, s.seasons_seen, s.seasons_up_wetter, s.seasons_down_wetter,
         s.persistence, s.passes_seen, s.passes_flooded_up, s.passes_flooded_down,
         s.crossing_km2, s.crossing_from, s.crossing_opening, s.crossing_opening_m,
         extensions.st_y(s.crossing_point), extensions.st_x(s.crossing_point),
         n.status, n.note, n.updated_at, u.unit_name
    from public.highway_stretches st
    join public.highway_sections s on s.id = st.best_section
    join public.districts d on d.code = s.district_code
    join public.tambons t on t.code = s.tambon_code
    left join public.highway_stretch_notes n on n.stretch_id = st.id
    left join public.authority_units u on u.id = n.unit_id
   where st.province_code = p_province
     and st.listed
   order by st.class, st.rank, st.id;
end $fn$;
revoke all on function public.highway_stretch_board(text) from public, anon;
grant execute on function public.highway_stretch_board(text) to authenticated;
