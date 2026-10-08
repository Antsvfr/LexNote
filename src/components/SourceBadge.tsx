import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, CircleHelp, FileText, Mic, NotebookPen, Sparkles, SplitSquareHorizontal } from 'lucide-react';
import { CONFIDENCE_HELP, CONFIDENCE_LABELS, type SourceConfidence, type SourceKind, type SourceReference } from '@/domain/course';
import { describeLocation, describeRefs, sourceHref } from '@/services/engine/sourceLabels';

const ICON = { NOTES: NotebookPen, TRANSCRIPT: Mic, DOCUMENT: FileText, SESSION: NotebookPen } as const;
const kindOf = (refs: SourceReference[]): SourceKind | 'MIX' | 'NONE' => { const k = new Set(refs.map((r) => r.location.kind)); return k.size === 0 ? 'NONE' : k.size > 1 ? 'MIX' : [...k][0]!; };

/**
 * Badge de provenance réutilisable : « Notes », « Transcription 00:34:12 », « PDF p. 18 », « Slide 24 », « Notes + transcription »…
 * Au clic : popover avec chaque source (emplacement, extrait exact) et un lien pour y revenir.
 */
const RANK = { NOTES: 0, TRANSCRIPT: 1, DOCUMENT: 2, SESSION: 3 } as const;
export function SourceBadge({ refs: raw, sessionId, generated = false }: { refs: SourceReference[]; sessionId: string; generated?: boolean }) {
  const refs = [...raw].sort((a, b) => RANK[a.location.kind] - RANK[b.location.kind]);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const kind = generated && !refs.length ? 'GEN' : kindOf(refs);
  const Icon = kind === 'GEN' ? Sparkles : kind === 'MIX' ? SplitSquareHorizontal : kind === 'NONE' ? CircleHelp : ICON[kind];
  const label = kind === 'GEN' ? 'Généré' : describeRefs(refs);
  return (
    <span ref={root} className="srcbadge-wrap">
      <button type="button" className={`srcbadge srcbadge--${kind.toLowerCase()}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} data-testid="source-badge" data-kind={kind}>
        <Icon size={12} aria-hidden /><span>{label}</span>
      </button>
      {open && (
        <div className="srcpop" role="dialog" aria-label="Sources" data-testid="source-popover">
          <strong className="srcpop__title">{refs.length > 1 ? `${refs.length} sources` : 'Source'}</strong>
          {refs.length === 0 && <p className="muted">Aucune source ne permet de confirmer cette information.</p>}
          <ul>
            {refs.map((r, i) => (
              <li key={`${r.chunkId}-${i}`}>
                <span className={`srcbadge srcbadge--${r.location.kind.toLowerCase()} srcbadge--static`}>{describeLocation(r.location)}</span>
                {r.location.headingPath && r.location.headingPath.length > 0 && r.location.kind === 'NOTES' && <small className="muted">{r.location.headingPath.join(' › ')}</small>}
                <q>{r.quote.length > 220 ? `${r.quote.slice(0, 219)}…` : r.quote}</q>
                <Link to={sourceHref(sessionId, r)} className="link" data-testid="source-open" onClick={() => setOpen(false)}>Ouvrir la source</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

const CONF_ICON = { VERIFIED: BadgeCheck, SUPPORTED: null, UNCERTAIN: CircleHelp, CONFLICTING: AlertTriangle, MISSING_SOURCE: AlertTriangle } as const;
/** Niveau de fiabilité (le niveau « appuyé par une source » reste discret : il est la norme). */
export function ConfidenceBadge({ level, note }: { level: SourceConfidence; note?: string }) {
  if (level === 'SUPPORTED') return null;
  const Icon = CONF_ICON[level]!;
  return (
    <span className={`confbadge confbadge--${level.toLowerCase()}`} title={`${CONFIDENCE_HELP[level]}${note ? ` — ${note}` : ''}`} data-testid="confidence-badge" data-level={level}>
      <Icon size={12} aria-hidden /> {CONFIDENCE_LABELS[level]}
    </span>
  );
}
