-- A7: a visitor cannot call the bell's sync function at all.
--
-- notices_sync() already returns nothing without a session (it reads auth.uid() first), but a
-- new function is executable by everyone unless that is taken away, and a writer should refuse a
-- caller it can do nothing for rather than answer them with silence.
revoke execute on function public.notices_sync(text[]) from public, anon;
grant execute on function public.notices_sync(text[]) to authenticated;
