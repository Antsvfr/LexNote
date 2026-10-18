/**
 * DOUBLE DE TEST du moteur IA — chargé UNIQUEMENT par le backend simulé (`VITE_BACKEND=mock`, tests automatisés), jamais en
 * production. Il ne prétend à aucune intelligence : il renvoie un document DÉTERMINISTE, dérivé mécaniquement du texte reçu,
 * étiqueté « moteur de test », pour vérifier le parcours complet (options, découpage, validation, enregistrement, erreurs).
 */
import type { AIProvider, AIRequest } from './index';
import { AIUnavailableError } from './index';

export type TestAIMode = 'ok' | 'error' | 'refuse' | 'slow' | 'markdown' | 'garbage';

const firstSentences = (t: string, n: number) => (t.match(/[^.!?…\n]+[.!?…]?/g) ?? [t]).map((x) => x.trim()).filter((x) => x.length > 3).slice(0, n);

export function createTestAIProvider(mode: () => TestAIMode, calls: AIRequest[] = []): AIProvider {
  return {
    id: 'test', label: 'Moteur de test', maxInputChars: 4000,
    isAvailable: () => true,
    async run(req) {
      calls.push({ ...req, signal: undefined });
      const m = mode();
      if (m === 'slow') await new Promise((r) => setTimeout(r, 1500));
      if (m === 'error') throw new AIUnavailableError('Le moteur IA est momentanément indisponible (erreur 503). Réessayez.');
      if (m === 'refuse') throw new AIUnavailableError('Le moteur IA a refusé de traiter ce contenu.', false);
      if (m === 'garbage') return out('{"blocks": "pas un document"}');
      const lang = String(req.options?.targetLanguage ?? req.options?.outputLanguage ?? 'fr');
      if (req.command === 'translate' || req.command === 'clean') {
        const blocks = req.input.split(/\n{2,}/).filter((p) => p.trim()).map((p) => ({ kind: 'paragraph', text: req.command === 'translate' ? `[${lang}] ${p.trim()}` : p.trim() }));
        return out(JSON.stringify({ blocks }));
      }
      if (req.command === 'digest') return out(firstSentences(req.input, 3).join(' '));
      const s = firstSentences(req.input, 6);
      if (m === 'markdown') return out(`# ${req.command}\n\n${s.map((x) => `- ${x}`).join('\n')}\n\n> **À retenir** — ${s[0] ?? ''}`);
      const blocks = [
        { kind: 'heading', level: 1, text: `${req.command}${req.options?.mode ? ` · ${req.options.mode}` : ''} (moteur de test)` },
        ...s.map((x) => ({ kind: 'bullet', text: x })),
        { kind: 'callout', tone: 'remember', text: s[0] ?? 'contenu' },
      ];
      return out(JSON.stringify({ blocks }));
    },
  };
}
const out = (text: string) => ({ text, provenance: 'AI' as const, verification: 'UNVERIFIED' as const, providerId: 'test', model: 'moteur-de-test', generatedAt: new Date().toISOString() });
