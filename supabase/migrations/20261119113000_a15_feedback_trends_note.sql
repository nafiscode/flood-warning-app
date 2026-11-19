-- The admins' feedback trends screen could not be opened at all: max(jsonb).
--
-- 20261027120000_a15_feedback built the 'improve' part of admin_feedback_trends() as
--   select c as code, count(*) as n, max(o.note) as done, max(o.change_ref) as change_ref
-- over a left join to feedback_outcomes, grouped by the code. feedback_outcomes.note is jsonb (the
-- note is kept per language), and Postgres has no max() for jsonb, so the statement never parsed:
-- every call of admin_feedback_trends() raised 'function max(jsonb) does not exist'. It is a
-- security-definer function the admin console calls directly, so the whole panel was dead, not
-- degraded. Nothing public and nothing an alert depends on; found 19 Nov 2026 by
-- tests/rls/feedback.test.ts ("counts a hidden item out of the public figures").
--
-- feedback_outcomes.code is its primary key, so there is at most one outcome per code and the
-- aggregate was only ever there to satisfy the group by. Two correlated subqueries read that one
-- row instead, which says what was meant and needs no aggregate over jsonb. The rest of the
-- function is 20261027120000's word for word.

create or replace function public.admin_feedback_trends(p_months integer default 12) returns jsonb
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
        select c as code, count(*) as n,
               (select o.note from public.feedback_outcomes o where o.code = c) as done,
               (select o.change_ref from public.feedback_outcomes o where o.code = c)
                 as change_ref
          from rows, unnest(rows.improve) as c
         group by c) q), '[]'::jsonb),
    'byStatus', coalesce((select jsonb_object_agg(status, n) from (
        select status::text as status, count(*) as n from rows group by status) q), '{}'::jsonb),
    'waitingPublic', (select count(*) from rows where public_status = 'pending')
  ) into v;
  return v;
end $$;
revoke execute on function public.admin_feedback_trends(integer) from public, anon;
grant execute on function public.admin_feedback_trends(integer) to authenticated;
