-- Whose home screen a dam's figure reaches, per dam (the owner, 14 Oct 2026: the same treatment
-- for every reservoir that matters).
--
-- Until today this was one list in the app's code - Yala, Pattani and Narathiwat, which is Bang
-- Lang's audience. With six reservoirs in four provinces it has to belong to the dam: Khlong
-- Sadao's water runs into Songkhla Lake and concerns nobody in Narathiwat, and a reservoir whose
-- channel nobody has mapped reaches nobody at all (it keeps its mark and its figures on the map).
alter table public.dams
  add column if not exists figure_provinces text[] not null default '{}';

comment on column public.dams.figure_provinces is
  'Province codes whose home screens show this dam figure card. Empty = the map only. Someone '
  'whose own tambon is on the dam path is told wherever they are, which is a separate rule.';
