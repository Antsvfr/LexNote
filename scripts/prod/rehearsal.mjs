#!/usr/bin/env node
// RÉPÉTITIONS sur un PostgreSQL LOCAL jetable (jamais Supabase, jamais la production) :
//   node scripts/prod/rehearsal.mjs backup-restore --url 'postgresql:///postgres?host=/var/tmp/pgsock&port=54329&user=postgres'
//   node scripts/prod/rehearsal.mjs db-rollback    --url …
// L'URL doit viser localhost / une socket Unix : tout autre hôte est REFUSÉ (le script crée et supprime des bases « rehearsal_* »).
// Il applique le « Supabase » minimal de tests/db/supabase-shim.sql puis les migrations RÉELLES de supabase/migrations/, avec les vrais outils
// pg_dump / psql — les mêmes que ceux sur lesquels reposent `supabase db dump` et la procédure du runbook (docs/PRODUCTION_RUNBOOK.md §I.2).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = 'supabase/migrations';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const TABLES = ['subjects', 'modules', 'course_sessions', 'study_artifacts', 'study_ai_requests'];

export function assertLocal(url) {
  const u = new URL(url);
  const host = u.hostname || u.searchParams.get('host') || '';
  if (!(host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('/'))) throw new Error(`REFUSÉ : ${host} n'est pas local (cette répétition ne touche jamais un serveur distant)`);
  return u;
}
const withDb = (url, db) => { const u = assertLocal(url); u.pathname = `/${db}`; return u.toString(); };

function sh(cmd, args, { input } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const psql = (url, sql, extra = []) => sh('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...extra, ...(sql === null ? [] : ['-c', sql])]);
const psqlFile = (url, file) => sh('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file]);
const must = (r, what) => { if (r.code !== 0) throw new Error(`${what} : ${r.err.trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`); return r.out.trim(); };

/** Le « Supabase » minimal, rendu rejouable : les rôles appartiennent au serveur entier, pas à la base. */
const shimFile = (dir) => {
  const sql = readFileSync('tests/db/supabase-shim.sql', 'utf8').replace(/create role (\w+) nologin( bypassrls)?;/g,
    (_m, r, b) => `do $$ begin if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r} nologin${b ?? ''}; end if; end $$;`);
  const f = join(dir, 'shim.sql'); writeFileSync(f, sql); return f;
};
const migrationSql = (f) => readFileSync(`${MIG}/${f}`, 'utf8').replace(/create extension[^;]*;/gi, '');
const migrations = () => readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();

/** Empreinte du CONTENU (pas des horodatages de sauvegarde) de chaque table : nombre de lignes + md5 de toutes les lignes en JSON. */
function contentHash(url) {
  const out = {};
  for (const t of TABLES) {
    const r = must(psql(url, `select count(*) || ':' || coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text)), '-') from public.${t} x`), `empreinte ${t}`);
    out[t] = r;
  }
  out.users = must(psql(url, `select count(*) || ':' || coalesce(md5(string_agg(id::text || email, '|' order by id)), '-') from auth.users`), 'empreinte users');
  return out;
}

function seed(url) {
  const sql = `
    insert into auth.users (id, email) values ('${A}', 'a@exemple.fr'), ('${B}', 'b@exemple.fr'), ('${C}', 'c@exemple.fr');
    insert into public.subjects (id, user_id, name)
      select ('aaaaaaaa-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, '${A}', 'Matière ' || i from generate_series(1, 5) i;
    insert into public.subjects (id, user_id, name) values ('bbbbbbbb-0000-4000-8000-000000000001', '${B}', 'Matière de B');
    insert into public.course_sessions (id, user_id, subject_id, title, date, notes_content, search_text)
      select ('cccccccc-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, '${A}', ('aaaaaaaa-0000-4000-8000-' || lpad(((i % 5) + 1)::text, 12, '0'))::uuid,
             'Séance ' || i, date '2026-10-01' + i, jsonb_build_object('type', 'doc', 'text', 'Notes importantes de la séance ' || i || ' — é à ç'), 'notes ' || i
      from generate_series(1, 20) i;
    insert into public.course_sessions (id, user_id, subject_id, title, date, notes_content)
      values ('dddddddd-0000-4000-8000-000000000001', '${B}', 'bbbbbbbb-0000-4000-8000-000000000001', 'Séance de B', '2026-10-02', '{"type":"doc","text":"privé B"}');
    -- Quelques mises à jour : versions serveur > 1 (curseurs de synchronisation à préserver)
    update public.course_sessions set title = title || ' (v2)' where id::text like 'cccccccc-0000-4000-8000-00000000000%';
    select public.study_ai_acquire('${A}', 'summarize', 1200, 2, 12, 200, 3000000);`;
  must(psql(url, null, ['-c', sql]), 'données de test');
}

export async function backupRestore(adminUrl, log = console.log) {
  const results = []; const check = (name, ok, detail = '') => { results.push(ok); log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok || !detail ? '' : `  [${detail}]`}`); };
  assertLocal(adminUrl);
  const stamp = Date.now(); const src = `rehearsal_src_${stamp}`, dst = `rehearsal_restore_${stamp}`, dst2 = `rehearsal_naive_${stamp}`;
  const dir = mkdtempSync(join(tmpdir(), 'lexnote-backup-'));
  const mk = (db) => { must(psql(adminUrl, `create database ${db}`), `création ${db}`); return withDb(adminUrl, db); };
  // Base de restauration neuve : le schéma `public` fourni par le modèle de base est retiré (le dump contient son propre CREATE SCHEMA public).
  const mkRestore = (db) => { const u = mk(db); must(psql(u, 'drop schema public cascade'), 'préparation de la base de restauration'); return u; };
  try {
    const url = mk(src);
    must(psqlFile(url, shimFile(dir)), 'shim');
    for (const f of migrations()) writeFileSync(join(dir, 'm.sql'), migrationSql(f)), must(psqlFile(url, join(dir, 'm.sql')), `migration ${f}`);
    check(`${migrations().length} migrations réelles appliquées sur PostgreSQL (version ${must(psql(url, 'show server_version')).split(' ')[0]})`, true);
    seed(url);
    const before = contentHash(url);
    check('données de test créées (utilisateurs, matières, séances avec notes accentuées, journal IA)', before.course_sessions.startsWith('21:') && before.subjects.startsWith('6:') && before.users.startsWith('3:'), JSON.stringify(before));

    // ---- SAUVEGARDE : mêmes découpages que le runbook (structure / données public / données auth)
    const dump = (name, args) => { const f = join(dir, name); const r = sh('pg_dump', [url, '--no-owner', '-f', f, ...args]); must(r, `pg_dump ${name}`); return f; };
    const schema = dump('schema.sql', ['--schema-only', '--schema', 'public', '--schema', 'auth']);
    const dataPublic = dump('data-public.sql', ['--data-only', '--schema', 'public']);
    const dataAuth = dump('data-auth.sql', ['--data-only', '--schema', 'auth']);
    const sums = ['schema.sql', 'data-public.sql', 'data-auth.sql'].map((n) => `${createHash('sha256').update(readFileSync(join(dir, n))).digest('hex')}  ${n}`);
    writeFileSync(join(dir, 'SHA256SUMS'), sums.join('\n') + '\n');
    check('sauvegarde produite (schema.sql, data-public.sql, data-auth.sql + SHA256SUMS), non vide', [schema, dataPublic, dataAuth].every((f) => readFileSync(f, 'utf8').length > 500));

    // ---- INCIDENT : modification + suppression
    must(psql(url, `update public.course_sessions set notes_content = '{"type":"doc","text":"ÉCRASÉ"}' where user_id = '${A}' and title like 'Séance 1%';
                    delete from public.course_sessions where id::text like 'cccccccc-0000-4000-8000-00000000001%';
                    delete from auth.users where id = '${C}';`), 'incident');
    const damaged = contentHash(url);
    check('l\'incident a bien modifié et supprimé des données (empreintes différentes)', JSON.stringify(damaged) !== JSON.stringify(before));

    // ---- RESTAURATION NAÏVE (déclencheurs actifs) : doit être détectée comme DÉFAUTEUSE (versions et horodatages réécrits par lx_touch)
    const naive = mkRestore(dst2);
    must(psqlFile(naive, schema), 'restauration schéma (naïve)');
    const naiveRun = [dataAuth, dataPublic].map((f) => sh('psql', [naive, '-X', '-q', '-f', f]));   // sans ON_ERROR_STOP : on observe ce qui se passe
    const naiveFailed = naiveRun.some((r) => /ERROR/.test(r.err));
    const naiveDiffers = naiveFailed || JSON.stringify(contentHash(naive)) !== JSON.stringify(before);
    check(`CONSTAT : restaurer les données AVEC les déclencheurs actifs ${naiveFailed ? 'ÉCHOUE (doublons de profils créés par le déclencheur d\'inscription)' : 'altère les données'} → la procédure doit désactiver les déclencheurs`, naiveDiffers, 'la restauration naïve est identique : constat à revoir');

    // ---- RESTAURATION CORRECTE : déclencheurs désactivés le temps de l'import (session_replication_role = replica)
    const good = mkRestore(dst);
    must(psqlFile(good, schema), 'restauration schéma');
    const withReplica = (f, n) => { const g = join(dir, n); writeFileSync(g, `set session_replication_role = replica;\n${readFileSync(f, 'utf8')}`); return g; };
    must(psqlFile(good, withReplica(dataAuth, 'r-auth.sql')), 'restauration auth');
    must(psqlFile(good, withReplica(dataPublic, 'r-public.sql')), 'restauration public');
    const restored = contentHash(good);
    check('restauration correcte (déclencheurs désactivés pendant l\'import) : contenu IDENTIQUE à l\'état d\'avant l\'incident', JSON.stringify(restored) === JSON.stringify(before), JSON.stringify({ before, restored }));
    const noteBack = must(psql(good, `select notes_content->>'text' from public.course_sessions where title like 'Séance 1 (v2)'`));
    check('une note précise est retrouvée telle qu\'elle était (accents compris)', noteBack === 'Notes importantes de la séance 1 — é à ç', noteBack);
    check('les versions serveur (curseurs de synchronisation) et horodatages font partie de l\'empreinte comparée : préservés', restored.course_sessions === before.course_sessions && restored.subjects === before.subjects);
    const sec = must(psql(good, `select (select count(*) from pg_policies where schemaname='public') || ',' || (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity) || ',' || has_function_privilege('anon','public.study_ai_acquire(uuid,text,integer,integer,integer,integer,bigint,integer,bigint)','execute') || ',' || public.app_health()::text`));
    const secSrc = must(psql(withDb(adminUrl, src), `select (select count(*) from pg_policies where schemaname='public') || ',' || (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity) || ',' || has_function_privilege('anon','public.study_ai_acquire(uuid,text,integer,integer,integer,integer,bigint,integer,bigint)','execute') || ',' || public.app_health()::text`));
    check('sécurité restaurée à l\'identique (politiques RLS, RLS activée, droits d\'exécution, app_health)', sec === secSrc && sec.includes(',false,'), sec);
    check('isolation conservée après restauration : B ne voit toujours pas les données de A', must(psql(good, `reset role; select set_config('request.jwt.claim.sub','${B}',false); set role authenticated; select count(*) from public.course_sessions where user_id <> '${B}'`, [])).split('\n').pop() === '0');
  } catch (e) {
    check('répétition interrompue', false, String(e.message).slice(0, 300));
  } finally {
    for (const db of [src, dst, dst2]) psql(adminUrl, `drop database if exists ${db} with (force)`);
  }
  log(`\n${results.filter(Boolean).length}/${results.length} contrôles réussis`);
  return results.every(Boolean) ? 0 : 1;
}

/** Retour arrière « code » : la base reste à la migration 18 (additive) et l'ANCIEN code continue de fonctionner, sans perte de données. */
export async function dbRollback(adminUrl, log = console.log) {
  const results = []; const check = (name, ok, detail = '') => { results.push(ok); log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok || !detail ? '' : `  [${detail}]`}`); };
  assertLocal(adminUrl);
  const db = `rehearsal_rb_${Date.now()}`; const dir = mkdtempSync(join(tmpdir(), 'lexnote-rb-'));
  const all = migrations(); const last = all.at(-1); const old = all.slice(0, -1);
  try {
    must(psql(adminUrl, `create database ${db}`), 'création base'); const url = withDb(adminUrl, db);
    must(psqlFile(url, shimFile(dir)), 'shim');
    const apply = (f) => { writeFileSync(join(dir, 'm.sql'), migrationSql(f)); must(psqlFile(url, join(dir, 'm.sql')), `migration ${f}`); };
    old.forEach(apply);
    check(`état « ancienne version » : migrations ${old[0].slice(0, 8)}…${old.at(-1).slice(0, 8)} appliquées (${old.length})`, true);
    seed(url);
    must(psql(url, `select public.study_ai_release((select max(id) from public.study_ai_requests), 'ok', 321)`), 'ancienne libération (3 arguments)');
    const before = contentHash(url);

    apply(last);
    check(`déploiement de la nouvelle version : ${last} appliquée`, true);
    const after = contentHash(url);
    check('AUCUNE donnée existante modifiée par la migration (tables métier identiques ; colonnes IA nouvelles = NULL)', ['subjects', 'modules', 'course_sessions', 'study_artifacts', 'users'].every((t) => after[t] === before[t])
      && must(psql(url, `select count(*) from public.study_ai_requests where model is not null or input_tokens is not null`)) === '0');

    // RETOUR ARRIÈRE du code : on garde la base à 18 et l'ANCIEN code appelle ses anciennes signatures
    const oldAcq = must(psql(url, `select public.study_ai_acquire('${A}', 'summarize', 1200, 2, 12, 200, 3000000)::text`));
    check('ancien code : study_ai_acquire à 7 arguments fonctionne sur la base migrée', oldAcq.includes('"ok": true'), oldAcq);
    const id = JSON.parse(oldAcq).id;
    must(psql(url, `select public.study_ai_release(${id}, 'ok', 456)`), 'ancien study_ai_release (3 arguments)');
    check('ancien code : study_ai_release à 3 arguments fonctionne', must(psql(url, `select status || ':' || output_tokens from public.study_ai_requests where id = ${id}`)) === 'ok:456');
    // nouveau code
    const gl = must(psql(url, `select public.study_ai_acquire('${A}', 'summarize', 1200, 2, 12, 200, 3000000, 1, 1000)::text`));
    check('nouveau code : le budget global s\'applique (1 requête/jour max → refus)', gl.includes('global_per_day'), gl);
    check('nouveau code : sonde de santé complète', must(psql(url, `select public.app_health()::text`)).replace(/\s/g, '').split('false').length === 1);
    check('ancien code : l\'ancien code n\'applique PAS le budget global (limite connue → couper l\'IA par ANTHROPIC_API_KEY, voir runbook)', JSON.parse(must(psql(url, `select public.study_ai_acquire('${A}', 'summarize', 1200, 20, 120, 2000, 3000000)::text`))).ok === true);
    const mid = contentHash(url);
    check('tables métier (hors journal IA) identiques à l\'état d\'avant déploiement', ['subjects', 'modules', 'course_sessions', 'study_artifacts', 'users'].every((t) => mid[t] === before[t]));
  } catch (e) {
    check('répétition interrompue', false, String(e.message).slice(0, 300));
  } finally { psql(adminUrl, `drop database if exists ${db} with (force)`); }
  log(`\n${results.filter(Boolean).length}/${results.length} contrôles réussis`);
  return results.every(Boolean) ? 0 : 1;
}

/**
 * Migrations REV-EM (000 → 009) sur un vrai PostgreSQL local, puis scénarios de la chaîne de lancement 008 / 009 :
 * intention créée (nonce HACHÉ), expiration, usage unique, IDENTIFY sans consommation, mauvais nonce, double clic, révocation, isolation, droits.
 */
export async function revemMigrations(adminUrl, revemRepo, log = console.log) {
  const results = []; const check = (name, ok, detail = '') => { results.push(ok); log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok || !detail ? '' : `  [${detail}]`}`); };
  assertLocal(adminUrl);
  const dir = mkdtempSync(join(tmpdir(), 'revem-mig-')); const db = `rehearsal_rev_${Date.now()}`;
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  const LA = `lnk_${'a'.repeat(30)}`, LB = `lnk_${'b'.repeat(30)}`;
  try {
    must(psql(adminUrl, `create database ${db}`), 'création base'); const url = withDb(adminUrl, db);
    must(psqlFile(url, shimFile(dir)), 'shim'); must(psqlFile(url, 'tests/db/supabase-shim-storage.sql'), 'shim storage');
    const files = readdirSync(join(revemRepo, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) { writeFileSync(join(dir, 'm.sql'), readFileSync(join(revemRepo, 'supabase/migrations', f), 'utf8')); must(psqlFile(url, join(dir, 'm.sql')), `migration REV-EM ${f}`); }
    check(`${files.length} migrations REV-EM (${files[0].slice(0, 3)} → ${files.at(-1).slice(0, 3)}) appliquées sur PostgreSQL ${must(psql(url, 'show server_version')).split(' ')[0]}`, files.length >= 10 && files.some((f) => f.startsWith('009')));
    const q = (sql) => must(psql(url, sql), sql.slice(0, 60));
    const j = (sql) => JSON.parse(q(sql));
    q(`insert into auth.users (id, email) values ('${A}', 'a@revem.t'), ('${B}', 'b@revem.t');
       insert into public.integration_links (user_id, provider, link_id, local_reference, external_reference, status, linked_at) values
         ('${A}', 'lexnote', '${LA}', '${'r'.repeat(20)}A', '${'x'.repeat(20)}A', 'CONNECTED', now()),
         ('${B}', 'lexnote', '${LB}', '${'r'.repeat(20)}B', '${'x'.repeat(20)}B', 'CONNECTED', now())`);
    const start = (user, link, nonce, ev = 'evt-1') => j(`select public.integration_launch_start('${user}', '${link}', '${ev}', '{"title":"Droit civil"}'::jsonb, '${sha(nonce)}', 300)::text`);
    const redeem = (id, nonce, link) => j(`select public.integration_launch_redeem('${id}', '${sha(nonce)}', '${link}')::text`);
    const identify = (id, nonce) => j(`select public.integration_launch_identify('${id}', '${sha(nonce)}')::text`);

    const s1 = start(A, LA, 'nonce-A1');
    check('intention créée pour une liaison CONNECTED', s1.reason === 'OK' && !!s1.intent_id);
    const row = q(`select nonce_hash || '|' || status || '|' || extract(epoch from (expires_at - created_at))::int from public.integration_launch_intents where id = '${s1.intent_id}'`).split('|');
    check('le nonce est HACHÉ (sha-256, jamais en clair) ; statut PENDING ; durée ≤ 15 min', row[0] === sha('nonce-A1') && !row[0].includes('nonce-A1') && row[1] === 'PENDING' && Number(row[2]) <= 900, row.join('|'));
    check('liaison inexistante / d\'un autre utilisateur → LINK_NOT_CONNECTED (isolation)', start(A, LB, 'n').reason === 'LINK_NOT_CONNECTED' && start(B, LA, 'n').reason === 'LINK_NOT_CONNECTED');

    check('IDENTIFY avec un mauvais nonce → NONCE_MISMATCH', identify(s1.intent_id, 'faux').reason === 'NONCE_MISMATCH');
    const idOk = identify(s1.intent_id, 'nonce-A1');
    check('IDENTIFY avec le bon nonce → OK (liaison + référence pseudonyme), SANS consommer l\'intention', idOk.reason === 'OK' && idOk.link_id === LA && q(`select status from public.integration_launch_intents where id = '${s1.intent_id}'`) === 'PENDING');
    check('REDEEM avec un mauvais nonce → NONCE_MISMATCH et l\'intention n\'est PAS consommée', redeem(s1.intent_id, 'faux', LA).reason === 'NONCE_MISMATCH' && q(`select status from public.integration_launch_intents where id = '${s1.intent_id}'`) === 'PENDING');
    check('REDEEM avec la mauvaise liaison → NOT_FOUND', redeem(s1.intent_id, 'nonce-A1', LB).reason === 'NOT_FOUND');
    const r1 = redeem(s1.intent_id, 'nonce-A1', LA);
    check('REDEEM correct → OK (évènement figé renvoyé), intention consommée', r1.reason === 'OK' && r1.event?.title === 'Droit civil' && q(`select status from public.integration_launch_intents where id = '${s1.intent_id}'`) === 'REDEEMED');
    check('double clic / rejeu : 2ᵉ REDEEM → USED ; IDENTIFY après usage → USED', redeem(s1.intent_id, 'nonce-A1', LA).reason === 'USED' && identify(s1.intent_id, 'nonce-A1').reason === 'USED');

    const s2 = start(A, LA, 'nonce-A2', 'evt-2');
    q(`update public.integration_launch_intents set created_at = now() - interval '200 seconds', expires_at = now() + interval '100 seconds' where id = '${s2.intent_id}'`);
    check('intention de plus de 120 s : IDENTIFY → EXPIRED (pas de connexion automatique) mais REDEEM reste possible (≤ 5 min)', identify(s2.intent_id, 'nonce-A2').reason === 'EXPIRED' && redeem(s2.intent_id, 'nonce-A2', LA).reason === 'OK');
    const s3 = start(A, LA, 'nonce-A3', 'evt-3');
    q(`update public.integration_launch_intents set created_at = now() - interval '400 seconds', expires_at = now() - interval '100 seconds' where id = '${s3.intent_id}'`);
    check('intention expirée → REDEEM et IDENTIFY : EXPIRED, statut mis à jour', redeem(s3.intent_id, 'nonce-A3', LA).reason === 'EXPIRED' && identify(s3.intent_id, 'nonce-A3').reason === 'EXPIRED' && q(`select status from public.integration_launch_intents where id = '${s3.intent_id}'`) === 'EXPIRED');

    const s4 = start(B, LB, 'nonce-B1', 'evt-4');
    q(`update public.integration_links set status = 'REVOKED', revoked_at = now(), revoked_by = 'self' where link_id = '${LB}'`);
    check('liaison révoquée après création : IDENTIFY et REDEEM → LINK_NOT_CONNECTED, rien consommé', identify(s4.intent_id, 'nonce-B1').reason === 'LINK_NOT_CONNECTED' && redeem(s4.intent_id, 'nonce-B1', LB).reason === 'LINK_NOT_CONNECTED' && q(`select status from public.integration_launch_intents where id = '${s4.intent_id}'`) === 'PENDING');
    check('liaison révoquée : nouvelle intention refusée', start(B, LB, 'n', 'evt-5').reason === 'LINK_NOT_CONNECTED');

    let last = ''; for (let i = 0; i < 22; i++) last = start(A, LA, `burst-${i}`, `evt-b${i}`).reason;
    check('plus de 20 intentions en attente → RATE_LIMITED', last === 'RATE_LIMITED');

    const denied = (sql) => psql(url, sql).code !== 0;
    check('un navigateur (authenticated / anon) ne peut ni lire ni écrire les intentions', denied(`set role authenticated; select count(*) from public.integration_launch_intents`) && denied(`set role anon; select count(*) from public.integration_launch_intents`) && denied(`set role authenticated; insert into public.integration_launch_intents (user_id, link_id, event_ref, event, nonce_hash, expires_at) values ('${A}', '${LA}', 'x', '{}', '${sha('x')}', now() + interval '1 minute')`));
    const priv = (role, fn) => q(`select has_function_privilege('${role}', '${fn}', 'execute')`) === 't';
    const fns = ['public.integration_launch_start(uuid,text,text,jsonb,text,int)', 'public.integration_launch_redeem(uuid,text,text)', 'public.integration_launch_identify(uuid,text,int)'];
    check('fonctions 008 / 009 : exécutables par service_role SEULEMENT (ni anon, ni authenticated, ni PUBLIC)', fns.every((f) => priv('service_role', f) && !priv('anon', f) && !priv('authenticated', f)));
    check('RLS FORCÉE sur les tables d\'intégration', q(`select count(*) from pg_class where relname in ('integration_links','integration_link_intents','integration_nonces','integration_launch_intents') and relrowsecurity and relforcerowsecurity`) === '4');
  } catch (e) { check('répétition interrompue', false, String(e.message).slice(0, 300)); }
  finally { psql(adminUrl, `drop database if exists ${db} with (force)`); }
  log(`\n${results.filter(Boolean).length}/${results.length} contrôles réussis`);
  return results.every(Boolean) ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2); const url = rest[rest.indexOf('--url') + 1];
  if (!url || !['backup-restore', 'db-rollback', 'revem-migrations'].includes(cmd)) { console.error('usage : rehearsal.mjs <backup-restore|db-rollback|revem-migrations> --url <postgresql://… local> [--revem-repo <dépôt REV-EM>]'); process.exit(2); }
  try { assertLocal(url); } catch (e) { console.error(e.message); process.exit(2); }
  const rr = rest.indexOf('--revem-repo') >= 0 ? rest[rest.indexOf('--revem-repo') + 1] : process.env.REVEM_REPO;
  if (cmd === 'revem-migrations' && !rr) { console.error('--revem-repo <dépôt REV-EM> requis'); process.exit(2); }
  (cmd === 'backup-restore' ? backupRestore(url) : cmd === 'db-rollback' ? dbRollback(url) : revemMigrations(url, rr)).then((c) => process.exit(c));
}
