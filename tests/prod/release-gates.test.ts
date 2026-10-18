// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error module .mjs sans types
import { evaluate } from '../../scripts/prod/lib/gates.mjs';

const doc = JSON.parse(readFileSync('release/gates.json', 'utf8'));
const NOW = new Date('2026-10-16T12:00:00Z');
const SHA = 'a'.repeat(40);
const allPass = (over: Record<string, unknown> = {}) => ({ results: Object.fromEntries(doc.gates.map((g: { id: string }) => [g.id, { status: 'PASS', sha: SHA, at: '2026-10-15T12:00:00Z', ...(over[g.id] as object) }])) });

describe('portes de déploiement', () => {
  it('définition cohérente : identifiants uniques, les portes auto ont une commande, les réelles sont présentes', () => {
    const ids = doc.gates.map((g: { id: string }) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of doc.gates) if (g.kind === 'auto') expect(g.command, g.id).toBeTruthy();
    for (const id of ['backup', 'supabase-smoke', 'ai-real-smoke', 'browsers-firefox-webkit', 'pwa-manual', 'rollback-rehearsed', 'integration-diagnostic']) expect(ids).toContain(id);
  });
  it('sans aucune preuve → NOT READY, toutes les portes NOT_RUN (jamais PASS)', () => {
    const r = evaluate(doc, {}, { sha: SHA, now: NOW });
    expect(r.verdict).toBe('NOT READY');
    expect(r.results.every((x: { status: string }) => x.status === 'NOT_RUN')).toBe(true);
  });
  it('toutes les portes PASS, récentes, sur le bon commit → READY', () => {
    expect(evaluate(doc, allPass(), { sha: SHA, now: NOW }).verdict).toBe('READY');
  });
  it('un seul échec, une preuve ancienne ou sur un autre commit → NOT READY', () => {
    expect(evaluate(doc, allPass({ build: { status: 'FAIL' } }), { sha: SHA, now: NOW }).blockers.map((b: { id: string }) => b.id)).toEqual(['build']);
    expect(evaluate(doc, allPass({ typecheck: { at: '2026-09-01T00:00:00Z' } }), { sha: SHA, now: NOW }).blockers[0].reason).toContain('trop ancienne');
    expect(evaluate(doc, allPass({ typecheck: { sha: 'b'.repeat(40) } }), { sha: SHA, now: NOW }).blockers[0].reason).toContain('autre commit');
  });
  it('une preuve de sauvegarde (sha: false) reste valable après un nouveau commit', () => {
    const r = evaluate(doc, allPass({ backup: { sha: 'old' } }), { sha: SHA, now: NOW });
    expect(r.blockers.find((b: { id: string }) => b.id === 'backup')).toBeUndefined();
  });
});
