import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { toast } from '@/store/toasts';
import { useArtifacts } from '@/store/artifacts';
import { LANGUAGES } from '@/domain/derived';
import { formatHMS } from '@/domain/capture';
import { AINotConfiguredError, AIOfflineError, AIAuthError, AIUnavailableError } from '@/services/ai';
import { SUMMARY_MODES, type SummaryMode, type TranscriptAction } from '@/services/transcript/actions';
import { EmptyTranscriptError, TooShortError, type DerivedSource, type Progress } from '@/services/transcript/pipeline';
import { InvalidModelOutputError } from '@/services/transcript/docFormat';
import { latestClean, runAndSave, sourceFromArtifact } from '@/services/transcript/run';
import { useAIStatus, AI_STATUS_LABELS } from './useAIStatus';
import { ActionIcon } from './ActionIcon';

export interface ActionRequest {
  action: TranscriptAction;
  sessionId: string;
  /** Source « transcription » (complète ou sélection). */
  transcript: DerivedSource;
}

/** Message propre pour chaque échec — jamais une trace technique. */
export function errorMessage(e: unknown): string {
  if (e instanceof AINotConfiguredError || e instanceof AIOfflineError || e instanceof AIAuthError || e instanceof AIUnavailableError
    || e instanceof EmptyTranscriptError || e instanceof TooShortError || e instanceof InvalidModelOutputError) return e.message;
  if (e instanceof DOMException && e.name === 'AbortError') return 'Action annulée.';
  return 'L’action n’a pas pu aboutir. Vos notes et votre transcription ne sont pas modifiées.';
}

/**
 * Options + exécution d'une action sur la transcription. Rien n'est lancé sans clic sur « Générer » ;
 * le résultat est un NOUVEAU support (l'original n'est jamais modifié).
 */
export function ActionDialog({ request, onClose }: { request: ActionRequest | null; onClose: () => void }) {
  const navigate = useNavigate();
  const status = useAIStatus();
  const items = useArtifacts((s) => s.items);
  const open = request !== null;
  const a = request?.action;
  const [mode, setMode] = useState<SummaryMode>('standard');
  const [target, setTarget] = useState('en');
  const [sourceChoice, setSourceChoice] = useState<string>('original');
  const [cleanDepth, setCleanDepth] = useState<'light' | 'ai'>('light');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const sid = request?.sessionId ?? '';
  const clean = useMemo(() => (sid ? latestClean(items, sid) : undefined), [items, sid]);
  const summaries = useMemo(() => items.filter((x) => x.type === 'SUMMARY' && x.sourceSessionIds[0] === sid).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)), [items, sid]);
  const isSelection = request?.transcript.kind === 'selection';

  useEffect(() => {
    if (!open) return;
    setMode('standard'); setTarget('en'); setSourceChoice('original'); setCleanDepth('light'); setProgress(null); setBusy(false); setError(null);
  }, [open, a?.id]);

  if (!request || !a) return <Modal open={false} onClose={onClose} title="" />;

  const needsAI = a.nature === 'ai' || (a.id === 'clean' && cleanDepth === 'ai');
  const blocked = needsAI && status !== 'ready';

  function pickSource(): DerivedSource {
    if (sourceChoice === 'clean' && clean) return sourceFromArtifact(clean);
    if (sourceChoice.startsWith('art:')) { const art = items.find((x) => x.id === sourceChoice.slice(4)); if (art) return sourceFromArtifact(art); }
    return request!.transcript;
  }

  async function submit() {
    if (busy || blocked) return;
    setBusy(true); setError(null); setProgress(null);
    ctl.current = new AbortController();
    try {
      const { artifact, notice } = await runAndSave({
        action: a!, sessionId: request!.sessionId, source: pickSource(), signal: ctl.current.signal, onProgress: setProgress,
        options: { ...(a!.options === 'summary' ? { mode } : {}), ...(a!.options === 'translate' ? { targetLanguage: target } : {}), ...(a!.id === 'clean' ? { cleanDepth } : {}) },
      });
      toast.success(`${a!.label} : support créé.`);
      if (notice) toast.info(notice);
      onClose();
      navigate(`/supports/${artifact.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  const cancel = () => { if (busy) ctl.current?.abort(); else onClose(); };
  const range = request.transcript.range;

  return (
    <Modal
      open={open} onClose={cancel} title={isSelection ? `${a.label} la sélection` : a.label} description={a.description} onSubmit={() => void submit()}
      footer={<>
        <button type="button" className="btn" onClick={cancel} data-testid="action-cancel">{busy ? 'Annuler l’action' : 'Fermer'}</button>
        <button type="submit" className="btn btn--primary" disabled={busy || blocked} data-testid="action-run"><ActionIcon name={a.icon} size={16} /> {busy ? 'Génération…' : 'Générer'}</button>
      </>}
    >
      <div className="xact" data-testid="action-dialog" data-action={a.id}>
        {isSelection && range && (
          <p className="muted xact__scope" data-testid="action-scope">Passage sélectionné · {formatHMS(range.startMs)} – {formatHMS(range.endMs)} · {request.transcript.words} mots</p>
        )}

        {a.options === 'summary' && (
          <div className="field"><span className="field-label">Type de résumé</span>
            <div className="xopts" role="radiogroup" aria-label="Type de résumé">
              {SUMMARY_MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`xopt${mode === m.id ? ' is-on' : ''}`} onClick={() => setMode(m.id)} data-testid={`summary-${m.id}`}>
                  <strong>{m.label}</strong><span>{m.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {a.options === 'translate' && (
          <>
            <div className="field"><label htmlFor="x-lang">Langue cible</label>
              <select id="x-lang" className="select" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="translate-target">
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            {!isSelection && (
              <div className="field"><span className="field-label">Que traduire ?</span>
                <div className="seg" role="radiogroup" aria-label="Contenu à traduire">
                  <button type="button" role="radio" aria-checked={!sourceChoice.startsWith('art:')} className={!sourceChoice.startsWith('art:') ? 'is-on' : ''} onClick={() => setSourceChoice(clean ? 'clean' : 'original')} data-testid="translate-full">Transcription complète</button>
                  <button type="button" role="radio" aria-checked={sourceChoice.startsWith('art:')} className={sourceChoice.startsWith('art:') ? 'is-on' : ''} disabled={!summaries.length} onClick={() => summaries[0] && setSourceChoice(`art:${summaries[0].id}`)} data-testid="translate-summary" title={summaries.length ? '' : 'Créez d’abord un résumé'}>Résumé seulement</button>
                </div>
                {sourceChoice.startsWith('art:') && summaries.length > 1 && (
                  <select className="select" aria-label="Résumé à traduire" value={sourceChoice} onChange={(e) => setSourceChoice(e.target.value)} style={{ marginTop: 8 }}>
                    {summaries.map((s) => <option key={s.id} value={`art:${s.id}`}>{s.title}</option>)}
                  </select>
                )}
              </div>
            )}
            <p className="muted xact__note">La transcription originale n’est jamais remplacée : la traduction est une nouvelle version, et vous pouvez revenir à l’original à tout moment.</p>
          </>
        )}

        {(a.options === 'source' || (a.options === 'translate' && !isSelection && !sourceChoice.startsWith('art:'))) && !isSelection && clean && (
          <div className="field"><span className="field-label">Texte de départ</span>
            <div className="seg" role="radiogroup" aria-label="Texte de départ">
              <button type="button" role="radio" aria-checked={sourceChoice === 'original'} className={sourceChoice === 'original' ? 'is-on' : ''} onClick={() => setSourceChoice('original')}>Transcription originale</button>
              <button type="button" role="radio" aria-checked={sourceChoice === 'clean'} className={sourceChoice === 'clean' ? 'is-on' : ''} onClick={() => setSourceChoice('clean')} data-testid="source-clean">Version nettoyée</button>
            </div>
          </div>
        )}

        {a.options === 'clean' && (
          <div className="field"><span className="field-label">Nettoyage</span>
            <div className="xopts" role="radiogroup" aria-label="Profondeur du nettoyage">
              <button type="button" role="radio" aria-checked={cleanDepth === 'light'} className={`xopt${cleanDepth === 'light' ? ' is-on' : ''}`} onClick={() => setCleanDepth('light')} data-testid="clean-light">
                <strong>Léger · sur l’appareil</strong><span>Hésitations, répétitions, ponctuation. Aucun mot modifié, rien n’est envoyé.</span>
              </button>
              <button type="button" role="radio" aria-checked={cleanDepth === 'ai'} className={`xopt${cleanDepth === 'ai' ? ' is-on' : ''}`} onClick={() => setCleanDepth('ai')} data-testid="clean-ai">
                <strong>Approfondi · IA</strong><span>Corrige aussi les erreurs évidentes de transcription, sans changer le sens.</span>
              </button>
            </div>
          </div>
        )}

        {needsAI && status !== 'ready' && (
          <div className="banner banner--warn" role="status" data-testid="ai-unavailable">
            <span><strong>{AI_STATUS_LABELS[status]}.</strong> {status === 'offline' ? 'Reconnectez-vous à Internet pour utiliser cette action.' : 'Aucun moteur d’IA n’est branché sur cette installation : rien n’est généré à votre place.'}</span>
          </div>
        )}
        {needsAI && status === 'ready' && <p className="muted xact__note">Seul le texte {isSelection ? 'du passage' : 'de la transcription'} est envoyé au moteur IA — jamais l’audio. Le résultat est à vérifier.</p>}

        {busy && progress && progress.total > 1 && (
          <div className="xprog" role="status" aria-live="polite" data-testid="action-progress">
            <span>{progress.step}… {Math.min(progress.done + 1, progress.total)}/{progress.total}</span>
            <span className="xprog__bar"><span style={{ width: `${Math.round(((progress.done + 1) / progress.total) * 100)}%` }} /></span>
          </div>
        )}
        {busy && (!progress || progress.total <= 1) && <p className="xprog muted" role="status" aria-live="polite">Génération en cours…</p>}
        {error && <div className="banner banner--warn" role="alert" data-testid="action-error"><span>{error}</span></div>}
      </div>
    </Modal>
  );
}
