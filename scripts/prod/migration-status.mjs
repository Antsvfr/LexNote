#!/usr/bin/env node
// Compare un projet Supabase (production OU test) à la chaîne de migrations 20261007…20261018 — LECTURE SEULE.
// N'EXÉCUTE JAMAIS de migration. Une seule requête SELECT (sondes structurelles) via l'API de gestion Supabase.
//
//   SUPABASE_ACCESS_TOKEN=… node scripts/prod/migration-status.mjs --project <ref>
//   node scripts/prod/migration-status.mjs --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres   # base LOCALE (supabase start) via psql
//   node scripts/prod/migration-status.mjs --from-json probes.json     # analyse hors ligne d'un résultat déjà obtenu
// Sortie : une ligne par migration (DÉJÀ APPLIQUÉE / ABSENTE / DIFFÉRENTE) puis « STOP » si une étape est DIFFÉRENTE ou hors ordre.
// Code de sortie : 0 = rien d'anormal, 1 = STOP, 2 = erreur d'usage / réseau.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildProbeSql, checkChain, classify, listMigrations, STATUS } from './lib/migrations.mjs';

const REF = /^[a-z0-9]{20}$/;

export async function run(argv, env, fetchImpl = fetch, out = console.log) {
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  let probes;
  if (flag('--from-json')) probes = JSON.parse(readFileSync(flag('--from-json'), 'utf8'));
  else if (flag('--db-url')) {
    // Base LOCALE (`supabase start`, PostgreSQL de test) via psql — une base distante est refusée : pour un projet hébergé, utiliser --project.
    const u = new URL(flag('--db-url')); const host = u.hostname || u.searchParams.get('host') || '';
    if (!(host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('/'))) { out('--db-url : seule une base LOCALE est acceptée (utiliser --project pour un projet Supabase)'); return 2; }
    const r = spawnSync('psql', [flag('--db-url'), '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', buildProbeSql()], { encoding: 'utf8' });
    if (r.status !== 0) { out(`psql a échoué : ${String(r.stderr).trim().split('\n').pop()?.slice(0, 200)}`); return 2; }
    probes = JSON.parse(r.stdout.trim().split('\n').pop());
  }
  else {
    const project = flag('--project');
    if (!project || !REF.test(project)) { out('usage : --project <référence du projet (20 caractères)> | --from-json <fichier>'); return 2; }
    if (!env.SUPABASE_ACCESS_TOKEN) { out('SUPABASE_ACCESS_TOKEN absent de l’environnement'); return 2; }
    let res;
    try {
      res = await fetchImpl(`https://api.supabase.com/v1/projects/${project}/database/query`, {
        method: 'POST', headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: buildProbeSql() }),
      });
    } catch { out('API Supabase injoignable'); return 2; }
    if (!res.ok) { out(`API Supabase → HTTP ${res.status}`); return 2; }
    const data = await res.json().catch(() => null);
    probes = Array.isArray(data) ? data[0]?.probes : data?.probes;
    if (!probes) { out('réponse inattendue de l’API (aucune sonde)'); return 2; }
  }
  const local = checkChain(listMigrations());
  for (const i of local) out(`[FAIL] dépôt : ${i}`);
  const r = classify(probes);
  for (const row of r.rows) out(`${row.status.padEnd(16)} ${row.file}${row.missing.length && row.status !== STATUS.applied ? `   (manque : ${row.missing.join(', ')})` : ''}`);
  for (const p of r.problems) out(`[STOP] ${p}`);
  out(r.pending.length ? `À APPLIQUER, dans cet ordre : ${r.pending.join(' → ')}` : 'Aucune migration à appliquer.');
  return r.stop || local.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run(process.argv.slice(2), process.env).then((c) => process.exit(c));
