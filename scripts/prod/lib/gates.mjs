// Portes de déploiement : lecture de release/gates.json + release/evidence.json (preuves) → READY / NOT READY. Aucun effet de bord.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const GATES_FILE = 'release/gates.json';
export const EVIDENCE_FILE = 'release/evidence.json';
export const STATUSES = ['PASS', 'FAIL', 'NOT_RUN'];

export const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };
export function currentSha() { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } }

/** Évalue chaque porte. Une preuve compte seulement si elle est PASS, assez récente et (si `sha`) enregistrée sur le commit COURANT. */
export function evaluate(gatesDoc, evidence, { sha = currentSha(), now = new Date() } = {}) {
  const maxAgeMs = (gatesDoc.maxAgeDays ?? 7) * 86_400_000;
  const results = gatesDoc.gates.map((g) => {
    const e = evidence?.results?.[g.id];
    let status = 'NOT_RUN'; let reason = 'aucune preuve enregistrée';
    if (e && STATUSES.includes(e.status)) {
      if (e.status !== 'PASS') { status = e.status; reason = e.status === 'FAIL' ? 'dernière exécution en échec' : 'non exécutée'; }
      else if (g.sha && e.sha !== sha) { status = 'NOT_RUN'; reason = `preuve sur un autre commit (${String(e.sha).slice(0, 7)} ≠ ${sha.slice(0, 7)})`; }
      else if (now - new Date(e.at) > maxAgeMs) { status = 'NOT_RUN'; reason = `preuve trop ancienne (> ${gatesDoc.maxAgeDays ?? 7} jours)`; }
      else { status = 'PASS'; reason = e.note ? String(e.note).slice(0, 120) : 'ok'; }
    }
    return { id: g.id, kind: g.kind, title: g.title, status, reason };
  });
  const blockers = results.filter((r) => r.status !== 'PASS');
  return { verdict: blockers.length ? 'NOT READY' : 'READY', sha, results, blockers };
}

export const loadAndEvaluate = (opts) => evaluate(readJson(GATES_FILE, { gates: [] }), existsSync(EVIDENCE_FILE) ? readJson(EVIDENCE_FILE, {}) : {}, opts);
