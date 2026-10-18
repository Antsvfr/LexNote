// Chaîne de migrations LexNote : liste, contrôle d'ordre, SONDES de lecture seule et classification (utilisé par preflight.mjs et migration-status.mjs).
// AUCUNE écriture, AUCUNE exécution de migration ici : les sondes sont des SELECT construits en interne.
import { readdirSync } from 'node:fs';

export const FIRST = '20261007000000';
export const LAST = '20261018000000';
const T = (t) => `to_regclass('public.${t}') is not null`;
const C = (t, c) => `exists (select 1 from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}')`;
const F = (f) => `exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f}')`;
const I = (i) => `exists (select 1 from pg_indexes where schemaname='public' and indexname='${i}')`;

/** Pour chaque migration : des marqueurs STRUCTURELS (la table `schema_migrations` n'est pas fiable : les migrations ont été appliquées par apply-sql). */
export const PROBES = {
  '20261007000000_lexnote_init.sql': { profiles: T('profiles'), subjects: T('subjects'), modules: T('modules'), course_sessions: T('course_sessions') },
  '20261008000000_study_artifacts.sql': { study_artifacts: T('study_artifacts') },
  '20261009000000_course_engine.sql': { source_documents: T('source_documents'), generated_courses: T('generated_courses') },
  '20261010000000_study_artifacts_from_course.sql': { settings_column: C('study_artifacts', 'settings'), options_renamed: `${T('study_artifacts')} and not ${C('study_artifacts', 'options')}`, course_version: C('study_artifacts', 'course_version') },
  '20261011000000_integration_links.sql': { integration_links: T('integration_links'), integration_link_intents: T('integration_link_intents'), integration_nonces: T('integration_nonces') },
  '20261012000000_fk_indexes.sql': { subjects_user_idx: I('subjects_user_idx'), modules_subject_idx: I('modules_subject_idx') },
  '20261013000000_security_hardening.sql': {
    search_path_fixed: `exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='lx_touch' and coalesce(p.proconfig::text,'') like '%search_path%')`,
    new_user_trigger_not_callable: `case when to_regprocedure('public.lx_handle_new_user()') is not null and exists (select 1 from pg_roles where rolname='anon') then not has_function_privilege('anon','public.lx_handle_new_user()','execute') else false end`,
  },
  '20261014000000_revem_course_refs.sql': { integration_course_refs: T('integration_course_refs'), integration_subject_refs: T('integration_subject_refs'), course_open: F('integration_course_open') },
  '20261015000000_transcript_derived_artifacts.sql': { source_type: C('study_artifacts', 'source_type'), source_session_id: C('study_artifacts', 'source_session_id') },
  '20261016000000_study_ai_usage.sql': { study_ai_requests: T('study_ai_requests'), acquire: F('study_ai_acquire'), release: F('study_ai_release') },
  '20261017000000_auth_devices_auto_login.sql': { auto_login: C('integration_links', 'auto_login'), user_devices: T('user_devices'), device_revoke: F('user_device_revoke') },
  '20261018000000_study_ai_budget_health.sql': { ai_model_column: C('study_ai_requests', 'model'), ai_started_index: I('study_ai_requests_started'), app_health: F('app_health'), usage_summary: F('study_ai_usage_summary') },
};

export const listMigrations = (dir = 'supabase/migrations') => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

/** Contrôle de la chaîne locale : nommage, ordre, doublons de horodatage, présence de toutes les étapes attendues. Retourne une liste de problèmes. */
export function checkChain(files) {
  const issues = [];
  const stamps = new Map();
  for (const f of files) {
    const m = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(f);
    if (!m) { issues.push(`nom de migration invalide : ${f}`); continue; }
    if (stamps.has(m[1])) issues.push(`horodatage en double ${m[1]} : ${stamps.get(m[1])} / ${f}`);
    stamps.set(m[1], f);
  }
  const sorted = [...files].sort();
  if (files.some((f, i) => f !== sorted[i])) issues.push('migrations non triées par horodatage');
  for (const f of Object.keys(PROBES)) if (!files.includes(f)) issues.push(`migration attendue absente du dépôt : ${f}`);
  for (const f of files) if (!(f in PROBES)) issues.push(`migration sans sonde de contrôle (ajouter dans scripts/prod/lib/migrations.mjs) : ${f}`);
  return issues;
}

/** Un seul SELECT en lecture seule qui renvoie { "<migration>": { "<sonde>": true|false } }. */
export function buildProbeSql() {
  const parts = Object.entries(PROBES).map(([file, probes]) =>
    `'${file}', jsonb_build_object(${Object.entries(probes).map(([k, sql]) => `'${k}', coalesce((${sql}), false)`).join(', ')})`);
  return `select jsonb_build_object(${parts.join(',\n  ')}) as probes`;
}

export const STATUS = { applied: 'DÉJÀ APPLIQUÉE', absent: 'ABSENTE', different: 'DIFFÉRENTE' };

/** Classe chaque migration et décide : `stop` si une étape est DIFFÉRENTE (partielle) ou si l'ordre est rompu (absente avant une appliquée). */
export function classify(results) {
  const rows = Object.keys(PROBES).map((file) => {
    const r = results?.[file] ?? {};
    const vals = Object.keys(PROBES[file]).map((k) => r[k] === true);
    const status = vals.every(Boolean) ? STATUS.applied : vals.some(Boolean) ? STATUS.different : STATUS.absent;
    return { file, status, missing: Object.keys(PROBES[file]).filter((k) => r[k] !== true) };
  });
  const problems = [];
  rows.forEach((row, i) => {
    if (row.status === STATUS.different) problems.push(`${row.file} : appliquée partiellement ou modifiée à la main (manque : ${row.missing.join(', ')})`);
    if (row.status === STATUS.absent && rows.slice(i + 1).some((x) => x.status === STATUS.applied)) problems.push(`${row.file} : ABSENTE alors qu'une migration plus récente est appliquée (ordre rompu)`);
  });
  const pending = rows.filter((r) => r.status === STATUS.absent).map((r) => r.file);
  return { rows, pending, problems, stop: problems.length > 0 };
}
