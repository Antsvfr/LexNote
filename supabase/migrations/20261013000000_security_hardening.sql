-- LexNote — security hardening after production reconciliation.
-- Fixes Supabase Security Advisor findings on trigger helper functions.

alter function public.lx_touch() set search_path = public, pg_temp;
alter function public.lx_profiles_touch() set search_path = public, pg_temp;
alter function public.lx_handle_new_user() set search_path = public, pg_temp;

revoke execute on function public.lx_handle_new_user() from public;
revoke execute on function public.lx_handle_new_user() from anon;
revoke execute on function public.lx_handle_new_user() from authenticated;
