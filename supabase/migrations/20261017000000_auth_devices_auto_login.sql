-- LexNote — authentification durable avec REV-EM (aucun mot de passe, aucun secret stocké ici).
--
-- 1) Consentement « connexion automatique depuis REV-EM », porté par la liaison existante (integration_links) :
--    * accordé EXPLICITEMENT par l'étudiant côté LexNote (case à cocher, jamais par défaut) ;
--    * effacé AUTOMATIQUEMENT dès que la liaison n'est plus CONNECTED (révocation d'un côté ou de l'autre, erreur) ;
--    * lu uniquement par le serveur (service_role) au moment d'un lancement sans session.
-- 2) Appareils de l'étudiant (« Rester connecté sur cet appareil ») : un UUID généré localement, un libellé lisible
--    (navigateur — système), le mode (application installée ou non) et l'identifiant de SESSION Supabase en cours (lu dans le JWT
--    par le serveur, jamais fourni par le navigateur). Aucune empreinte de navigateur, aucun jeton, aucun mot de passe.
--    Déconnecter un appareil = supprimer SA session Supabase (auth.sessions) : son jeton de rafraîchissement cesse aussitôt de fonctionner.

/* --------------------------------------------------------------- 1) consentement de connexion automatique */
alter table public.integration_links add column auto_login boolean not null default false;
alter table public.integration_links add column auto_login_at timestamptz;

-- Garde en base : une liaison non CONNECTED ne peut JAMAIS porter le consentement (révocation = retrait immédiat, sans dépendre du code).
create or replace function public.links_guard_auto_login() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status <> 'CONNECTED' and new.auto_login then
    new.auto_login := false;
    new.auto_login_at := now();
  end if;
  return new;
end $$;
create trigger links_guard_auto_login before insert or update on public.integration_links
  for each row execute function public.links_guard_auto_login();

create or replace function public.integration_set_auto_login(p_user uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.integration_links set auto_login = coalesce(p_enabled, false), auto_login_at = now(), updated_at = now()
    where user_id = p_user and status = 'CONNECTED';
  if not found then return jsonb_build_object('reason', 'NOT_FOUND'); end if;
  return jsonb_build_object('reason', 'OK', 'auto_login', coalesce(p_enabled, false));
end $$;

/* --------------------------------------------------------------- 2) appareils */
create table public.user_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null,
  label text not null check (char_length(label) between 1 and 80),
  standalone boolean not null default false,
  remember boolean not null default false,
  session_id uuid,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table public.user_devices enable row level security;
alter table public.user_devices force row level security;
revoke all on public.user_devices from public, anon, authenticated;
grant select on public.user_devices to authenticated;
create policy user_devices_select_own on public.user_devices for select to authenticated using ((select auth.uid()) = user_id);

/** Session Supabase de l'appelant : lue dans SON jeton (claim `session_id`), jamais dans un paramètre. */
create or replace function public.user_device_current_session() returns uuid
language sql stable set search_path = public, pg_temp as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')::uuid
$$;

create or replace function public.user_device_touch(p_device uuid, p_label text, p_standalone boolean, p_remember boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return jsonb_build_object('reason', 'UNAUTHENTICATED'); end if;
  if p_device is null then return jsonb_build_object('reason', 'INVALID'); end if;
  insert into public.user_devices (user_id, device_id, label, standalone, remember, session_id, last_seen_at)
    values (v_user, p_device, left(coalesce(nullif(trim(p_label), ''), 'Appareil'), 80), coalesce(p_standalone, false), coalesce(p_remember, false),
            public.user_device_current_session(), now())
  on conflict (user_id, device_id) do update
    set label = excluded.label, standalone = excluded.standalone, remember = excluded.remember,
        session_id = coalesce(excluded.session_id, public.user_devices.session_id), last_seen_at = now();
  -- Liste bornée : au-delà de 30 appareils, les plus anciens disparaissent (simple registre d'affichage).
  delete from public.user_devices where user_id = v_user and device_id in (
    select device_id from public.user_devices where user_id = v_user order by last_seen_at desc offset 30);
  return jsonb_build_object('reason', 'OK');
end $$;

/** Déconnecte UN appareil : sa session Supabase est supprimée (le jeton de rafraîchissement devient inutilisable immédiatement). */
create or replace function public.user_device_revoke(p_device uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_session uuid;
begin
  if v_user is null then return jsonb_build_object('reason', 'UNAUTHENTICATED'); end if;
  select session_id into v_session from public.user_devices where user_id = v_user and device_id = p_device;
  if not found then return jsonb_build_object('reason', 'NOT_FOUND'); end if;
  if v_session is not null then delete from auth.sessions where id = v_session and user_id = v_user; end if;
  delete from public.user_devices where user_id = v_user and device_id = p_device;
  return jsonb_build_object('reason', 'OK');
end $$;

/** Après « Déconnecter tous les appareils » (déconnexion globale Supabase) : le registre est vidé. */
create or replace function public.user_device_forget_all() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); n int;
begin
  if v_user is null then return jsonb_build_object('reason', 'UNAUTHENTICATED'); end if;
  delete from auth.sessions where user_id = v_user;
  delete from public.user_devices where user_id = v_user;
  get diagnostics n = row_count;
  return jsonb_build_object('reason', 'OK', 'forgotten', n);
end $$;

/* --------------------------------------------------------------- droits */
revoke all on function public.links_guard_auto_login() from public, anon, authenticated;
revoke all on function public.integration_set_auto_login(uuid, boolean) from public, anon, authenticated;
revoke all on function public.user_device_current_session() from public, anon;
revoke all on function public.user_device_touch(uuid, text, boolean, boolean) from public, anon;
revoke all on function public.user_device_revoke(uuid) from public, anon;
revoke all on function public.user_device_forget_all() from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.integration_set_auto_login(uuid, boolean) to service_role;
  end if;
end $$;
grant execute on function public.user_device_current_session() to authenticated;
grant execute on function public.user_device_touch(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.user_device_revoke(uuid) to authenticated;
grant execute on function public.user_device_forget_all() to authenticated;

notify pgrst, 'reload schema';
