import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Copy, Download, Languages, Lightbulb, ScrollText, Search, SquareStack, X } from 'lucide-react';
import { Menu } from '@/components/Menu';
import { toast } from '@/store/toasts';
import { normalize } from '@/lib/text';
import { formatHMS, wallClock, type TranscriptSegment } from '@/domain/capture';
import { downloadBlob, fileSafe } from '@/services/study/export';

export interface SelectionInfo { text: string; range: { startMs: number; endMs: number }; words: number }

/** « 1:02:03 », « 12:30 », « 90 » (minutes) → ms. */
export function parseTimeInput(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 60_000;
  const parts = t.split(':').map((x) => Number(x));
  if (parts.some((x) => !Number.isFinite(x) || x < 0) || parts.length > 3) return null;
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0]!, parts[1]!];
  return ((h! * 60 + m!) * 60 + s!) * 1000;
}

export function transcriptToText(segments: TranscriptSegment[], originAt: number, withTimes: boolean): string {
  return segments.map((s) => (withTimes ? `[${originAt ? wallClock(originAt, s.startMs) : formatHMS(s.startMs)}] ${s.text}` : s.text)).join(withTimes ? '\n' : ' ').trim();
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success('Copié dans le presse-papiers.'); }
  catch { toast.error('Copie impossible : le navigateur l’a refusée.'); }
}

/** Outils de relecture : recherche (occurrences, précédente/suivante), aller à un instant, copier, exporter. */
export function TranscriptTools({ segments, originAt, sessionTitle, query, onQuery, onGoTo, onSeek }: {
  segments: TranscriptSegment[]; originAt: number; sessionTitle: string; query: string;
  onQuery: (q: string) => void; onGoTo: (segId: string) => void; onSeek: (ms: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState('');
  const matches = useMemo(() => {
    const q = normalize(query.trim());
    return q.length >= 2 ? segments.filter((s) => normalize(s.text).includes(q)).map((s) => s.id) : [];
  }, [segments, query]);
  const go = (k: number) => { if (!matches.length) return; const i = (k + matches.length) % matches.length; setIdx(i); setStarted(true); onGoTo(matches[i]!); };
  const base = fileSafe(`Transcription — ${sessionTitle}`);

  return (
    <div className="ttools" data-testid="transcript-tools">
      <label className="ttools__search">
        <Search size={14} aria-hidden />
        <input value={query} onChange={(e) => { onQuery(e.target.value); setIdx(0); setStarted(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(!started ? 0 : e.shiftKey ? idx - 1 : idx + 1); } }}
          placeholder="Rechercher dans la transcription" aria-label="Rechercher dans la transcription" data-testid="transcript-search" />
        {query.trim().length >= 2 && <span className="ttools__count" data-testid="transcript-search-count">{matches.length ? `${idx + 1}/${matches.length}` : '0'}</span>}
        <button type="button" className="ttools__ib" aria-label="Occurrence précédente" onClick={() => go(idx - 1)} disabled={!matches.length}><ChevronUp size={14} /></button>
        <button type="button" className="ttools__ib" aria-label="Occurrence suivante" onClick={() => go(started ? idx + 1 : 0)} disabled={!matches.length} data-testid="transcript-search-next"><ChevronDown size={14} /></button>
      </label>
      <form className="ttools__time" onSubmit={(e) => { e.preventDefault(); const ms = parseTimeInput(time); if (ms === null) { toast.error('Instant invalide : utilisez mm:ss ou hh:mm:ss.'); return; } onSeek(ms); }}>
        <Clock size={14} aria-hidden />
        <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="00:12:30" aria-label="Aller à l’instant (depuis le début)" inputMode="numeric" data-testid="transcript-goto" />
      </form>
      <button type="button" className="btn btn--sm" onClick={() => void copy(transcriptToText(segments, originAt, false))} data-testid="transcript-copy"><Copy size={14} /> Copier</button>
      <Menu trigger={(p) => <button className="btn btn--sm" {...p} data-testid="transcript-export"><Download size={14} /> Exporter</button>}>
        {(close) => (
          <>
            <button className="menu__item" role="menuitem" data-testid="transcript-export-txt" onClick={() => { close(); downloadBlob(`${base}.txt`, new Blob([`${sessionTitle}\n\n${transcriptToText(segments, originAt, true)}\n`], { type: 'text/plain;charset=utf-8' })); }}>Texte (.txt), horodaté</button>
            <button className="menu__item" role="menuitem" data-testid="transcript-export-md" onClick={() => { close(); downloadBlob(`${base}.md`, new Blob([`# Transcription — ${sessionTitle}\n\n${segments.map((s) => `**${formatHMS(s.startMs)}** ${s.text}`).join('\n\n')}\n`], { type: 'text/markdown;charset=utf-8' })); }}>Markdown (.md)</button>
          </>
        )}
      </Menu>
    </div>
  );
}

/** Barre d'actions sur le passage sélectionné (bas du panneau : utilisable au doigt comme à la souris). */
export function SelectionBar({ selection, onAction, onClose }: { selection: SelectionInfo; onAction: (id: string) => void; onClose: () => void }) {
  return (
    <div className="tselbar" role="toolbar" aria-label="Actions sur la sélection" data-testid="selection-bar">
      <span className="tselbar__info">Sélection · {formatHMS(selection.range.startMs)}–{formatHMS(selection.range.endMs)} · {selection.words} mots</span>
      <button type="button" className="btn btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onAction('summarize-selection')} data-testid="sel-summarize"><ScrollText size={14} /> Résumer</button>
      <button type="button" className="btn btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onAction('translate-selection')} data-testid="sel-translate"><Languages size={14} /> Traduire</button>
      <button type="button" className="btn btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onAction('explain')} data-testid="sel-explain"><Lightbulb size={14} /> Expliquer</button>
      <button type="button" className="btn btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onAction('flashcard')} data-testid="sel-flashcard"><SquareStack size={14} /> Flashcard</button>
      <button type="button" className="ttools__ib" aria-label="Fermer" onMouseDown={(e) => e.preventDefault()} onClick={onClose}><X size={14} /></button>
      <button type="button" className="ttools__ib" aria-label="Copier la sélection" onMouseDown={(e) => e.preventDefault()} onClick={() => void copy(selection.text)}><Copy size={14} /></button>
    </div>
  );
}
