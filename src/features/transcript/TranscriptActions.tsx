import { useMemo, useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import { useUI } from '@/store/ui';
import { GROUP_LABELS, PRIMARY_ACTIONS, SECONDARY_ACTIONS, suggestActions, actionById, type TranscriptAction } from '@/services/transcript/actions';
import type { DerivedSource } from '@/services/transcript/pipeline';
import { ActionIcon } from './ActionIcon';
import { ActionDialog, type ActionRequest } from './ActionDialog';
import { useAIStatus, AI_STATUS_LABELS } from './useAIStatus';

const NATURE_TAG: Record<TranscriptAction['nature'], string> = { ai: 'IA', local: 'Sur l’appareil', support: 'Moteur de cours' };

/**
 * « Exploiter la transcription » : 4 actions principales, le reste dans « Plus d'actions » (groupé), et au plus 3 suggestions
 * légères selon le contenu. Chaque action a la même identité : icône, nom, description courte, état.
 */
export function TranscriptActions({ sessionId, source, onOpenTranscript }: { sessionId: string; source: DerivedSource; onOpenTranscript?: () => void }) {
  const status = useAIStatus();
  const openSupport = useUI((s) => s.openSupportDialog);
  const [more, setMore] = useState(false);
  const [req, setReq] = useState<ActionRequest | null>(null);
  const text = useMemo(() => source.paragraphs.map((p) => p.text).join('\n'), [source.paragraphs]);
  const suggestions = useMemo(() => suggestActions(text, source.words), [text, source.words]);
  const empty = source.words === 0;

  const launch = (a: TranscriptAction) => {
    if (a.nature === 'support') { openSupport({ sessionId, type: a.supportType }); return; }
    setReq({ action: a, sessionId, transcript: source });
  };
  const state = (a: TranscriptAction): { label: string; tone: 'ok' | 'off' | 'warn' } => {
    if (a.nature === 'support') return { label: NATURE_TAG.support, tone: 'ok' };
    if (a.nature === 'local') return { label: NATURE_TAG.local, tone: 'ok' };
    if (status === 'ready') return { label: NATURE_TAG.ai, tone: 'ok' };
    return { label: status === 'offline' ? 'Hors ligne' : 'IA non configurée', tone: status === 'offline' ? 'warn' : 'off' };
  };
  const tooShort = (a: TranscriptAction) => a.nature !== 'support' && source.words > 0 && source.words < a.minWords;

  const Card = ({ a, compact = false }: { a: TranscriptAction; compact?: boolean }) => {
    const st = state(a); const short = tooShort(a);
    return (
      <button type="button" className={`xcard${compact ? ' xcard--row' : ''}${st.tone === 'off' ? ' is-off' : ''}`} onClick={() => launch(a)} disabled={empty && a.nature !== 'support'}
        data-testid={`xaction-${a.id}`} title={short ? `Transcription trop courte pour « ${a.label} »` : a.description}>
        <span className="xcard__icon"><ActionIcon name={a.icon} size={compact ? 16 : 18} /></span>
        <span className="xcard__txt"><strong>{a.label}</strong>{!compact && <span>{a.description}</span>}</span>
        <span className={`xcard__state xcard__state--${st.tone}`}>{short ? 'Trop court' : st.label}</span>
      </button>
    );
  };

  return (
    <section className="xpanel" aria-labelledby="xpanel-h" data-testid="transcript-actions">
      <header className="xpanel__head">
        <div>
          <h2 id="xpanel-h" className="section-title">Exploiter la transcription</h2>
          <p className="muted xpanel__sub">{empty ? 'Aucune transcription pour cette séance : activez-la pendant le cours pour débloquer ces actions.' : `${source.words.toLocaleString('fr-FR')} mots · chaque résultat est un nouveau support, la transcription originale reste intacte.`}</p>
        </div>
        <span className={`xstatus xstatus--${status}`} data-testid="ai-status">{AI_STATUS_LABELS[status]}</span>
      </header>

      <div className="xgrid" role="group" aria-label="Actions principales">
        {PRIMARY_ACTIONS.map((a) => <Card key={a.id} a={a} />)}
      </div>

      {suggestions.length > 0 && (
        <ul className="xsuggest" data-testid="xsuggestions" aria-label="Suggestions">
          {suggestions.map((s) => { const a = actionById(s.actionId)!; return (
            <li key={s.actionId}><button type="button" className="chip" onClick={() => launch(a)} data-testid={`xsuggest-${a.id}`}><Lightbulb size={13} aria-hidden /> {a.label}</button><span className="muted">{s.reason}</span></li>
          ); })}
        </ul>
      )}

      <button type="button" className="xmore" aria-expanded={more} onClick={() => setMore((v) => !v)} data-testid="xmore">
        Plus d’actions <ChevronDown size={15} aria-hidden className={more ? 'is-open' : ''} />
      </button>
      {more && (
        <div className="xgroups" data-testid="xmore-panel">
          {(Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[]).map((g) => (
            <div key={g} className="xgroup">
              <h3>{GROUP_LABELS[g]}</h3>
              <div className="xlist">{SECONDARY_ACTIONS.filter((a) => a.group === g).map((a) => <Card key={a.id} a={a} compact />)}</div>
            </div>
          ))}
          {onOpenTranscript && <p className="muted xgroups__hint">Astuce : sélectionnez un passage dans l’onglet <button type="button" className="link" onClick={onOpenTranscript}>Transcription</button> pour le résumer, le traduire, l’expliquer ou en faire une flashcard.</p>}
        </div>
      )}
      <ActionDialog request={req} onClose={() => setReq(null)} />
    </section>
  );
}
