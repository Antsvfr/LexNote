#!/usr/bin/env node
// Enregistre les PREUVES des portes de déploiement dans release/evidence.json (fichier local, non versionné).
//   node scripts/prod/evidence.mjs run-auto                      exécute les portes `auto` et enregistre PASS/FAIL (commit courant)
//   node scripts/prod/evidence.mjs record <porte> PASS|FAIL|NOT_RUN [--note "…"]   preuve humaine/réelle (smoke de TEST, navigateurs, sauvegarde)
//   node scripts/prod/evidence.mjs show
// Ne copiez jamais de secret dans --note.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_FILE, GATES_FILE, STATUSES, currentSha, readJson } from './lib/gates.mjs';

const save = (ev) => { mkdirSync('release', { recursive: true }); writeFileSync(EVIDENCE_FILE, JSON.stringify(ev, null, 2) + '\n'); };

export function record(id, status, note, now = new Date()) {
  const gates = readJson(GATES_FILE, { gates: [] }).gates;
  if (!gates.some((g) => g.id === id)) throw new Error(`porte inconnue : ${id} (voir ${GATES_FILE})`);
  if (!STATUSES.includes(status)) throw new Error(`statut invalide : ${status} (PASS | FAIL | NOT_RUN)`);
  const ev = readJson(EVIDENCE_FILE, { results: {} });
  ev.results = { ...ev.results, [id]: { status, sha: currentSha(), at: now.toISOString(), ...(note ? { note: String(note).slice(0, 300) } : {}) } };
  save(ev);
  return ev.results[id];
}

export function main(argv, out = console.log) {
  const [cmd, a, b, ...rest] = argv;
  if (cmd === 'record') {
    const i = rest.indexOf('--note');
    const r = record(a, b, i >= 0 ? rest[i + 1] : (argv.includes('--note') ? argv[argv.indexOf('--note') + 1] : undefined));
    out(`${a} → ${r.status} (commit ${r.sha.slice(0, 7)})`); return 0;
  }
  if (cmd === 'run-auto') {
    let bad = 0;
    for (const g of readJson(GATES_FILE, { gates: [] }).gates.filter((x) => x.kind === 'auto')) {
      out(`→ ${g.id} : ${g.command}`);
      const r = spawnSync(g.command, { shell: true, stdio: 'inherit' });
      const ok = r.status === 0; if (!ok) bad++;
      record(g.id, ok ? 'PASS' : 'FAIL');
    }
    return bad ? 1 : 0;
  }
  if (cmd === 'show') { out(JSON.stringify(readJson(EVIDENCE_FILE, { results: {} }), null, 2)); return 0; }
  out('usage : run-auto | record <porte> <PASS|FAIL|NOT_RUN> [--note "…"] | show'); return 2;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(e.message); process.exit(2); } }
