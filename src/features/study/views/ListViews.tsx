import { ChevronLeft, ChevronRight, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { newId } from '@/lib/ids';
import type { FlashcardsContent, QuizContent, TimelineContent } from '@/domain/study';
import { Sources } from './Sources';

/** Flashcards : mode révision (retourner / suivant) + liste modifiable. */
export function FlashcardsView({ content, onChange, showSources }: { content: FlashcardsContent; onChange(c: FlashcardsContent): void; showSources: boolean }) {
  const [k, setK] = useState(0); const [flip, setFlip] = useState(false);
  const cur = content.cards[Math.min(k, content.cards.length - 1)];
  const upd = (fn: (c: FlashcardsContent) => void) => { const c = structuredClone(content); fn(c); onChange(c); };
  return (
    <div className="cards" data-testid="flashcards">
      {cur && (
        <div className="paper study no-print">
          <button className={`flipcard${flip ? ' is-flip' : ''}`} onClick={() => setFlip(!flip)} aria-label="Retourner la carte" data-testid="flipcard">
            <span className="flipcard__side">{flip ? cur.back : cur.front}</span><small>{flip ? 'Verso' : 'Recto'} · {k + 1} / {content.cards.length}</small>
          </button>
          <div className="study__nav">
            <button className="btn btn--sm" onClick={() => { setK((k + content.cards.length - 1) % content.cards.length); setFlip(false); }}><ChevronLeft /> Précédente</button>
            <button className="btn btn--sm" onClick={() => setFlip(!flip)}><RotateCw /> Retourner</button>
            <button className="btn btn--sm" onClick={() => { setK((k + 1) % content.cards.length); setFlip(false); }}>Suivante <ChevronRight /></button>
          </div>
          {showSources && <Sources sources={cur.sources} />}
        </div>
      )}
      <div className="paper list">
        {content.cards.map((c) => (
          <div key={c.id} className="list__row" data-testid="card-row">
            <textarea aria-label="Recto" value={c.front} rows={2} onChange={(e) => upd((x) => { x.cards.find((i) => i.id === c.id)!.front = e.target.value || c.front; })} />
            <textarea aria-label="Verso" value={c.back} rows={2} onChange={(e) => upd((x) => { x.cards.find((i) => i.id === c.id)!.back = e.target.value || c.back; })} />
            <button className="iconbtn no-print" aria-label="Supprimer la carte" onClick={() => upd((x) => { x.cards = x.cards.filter((i) => i.id !== c.id); })}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn btn--sm no-print" onClick={() => upd((x) => { x.cards.push({ id: newId(), front: 'Question', back: 'Réponse', sources: [] }); })}><Plus /> Ajouter une carte</button>
      </div>
    </div>
  );
}

export function QuizView({ content, onChange, showSources }: { content: QuizContent; onChange(c: QuizContent): void; showSources: boolean }) {
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const upd = (fn: (c: QuizContent) => void) => { const c = structuredClone(content); fn(c); onChange(c); };
  return (
    <div className="paper list" data-testid="quiz">
      <p className="muted">Auto-test de rappel : répondez de mémoire puis vérifiez avec votre propre passage du cours.</p>
      {content.questions.map((q, n) => (
        <div key={q.id} className="quizq" data-testid="quiz-q">
          <strong>{n + 1}. </strong>
          <textarea aria-label="Question" value={q.prompt} rows={2} onChange={(e) => upd((x) => { x.questions.find((i) => i.id === q.id)!.prompt = e.target.value || q.prompt; })} />
          <button className="btn btn--sm no-print" onClick={() => setShown({ ...shown, [q.id]: !shown[q.id] })} aria-expanded={!!shown[q.id]}>{shown[q.id] ? 'Masquer' : 'Voir la réponse'}</button>
          {shown[q.id] && <div className="quizq__a"><textarea aria-label="Réponse" value={q.answer} rows={3} onChange={(e) => upd((x) => { x.questions.find((i) => i.id === q.id)!.answer = e.target.value || q.answer; })} />{showSources && <Sources sources={q.sources} />}</div>}
          <button className="iconbtn no-print" aria-label="Supprimer la question" onClick={() => upd((x) => { x.questions = x.questions.filter((i) => i.id !== q.id); })}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function TimelineView({ content, onChange, showSources }: { content: TimelineContent; onChange(c: TimelineContent): void; showSources: boolean }) {
  const upd = (fn: (c: TimelineContent) => void) => { const c = structuredClone(content); fn(c); onChange(c); };
  return (
    <ol className="paper timeline" data-testid="timeline">
      {content.events.map((e) => (
        <li key={e.id} data-testid="timeline-event">
          <input className="timeline__date" aria-label="Date" value={e.date} onChange={(ev) => upd((x) => { x.events.find((i) => i.id === e.id)!.date = ev.target.value; })} />
          <div><textarea aria-label="Évènement" value={e.label} rows={2} onChange={(ev) => upd((x) => { x.events.find((i) => i.id === e.id)!.label = ev.target.value || e.label; })} />{showSources && <Sources sources={e.sources} />}</div>
          <button className="iconbtn no-print" aria-label="Supprimer l’évènement" onClick={() => upd((x) => { x.events = x.events.filter((i) => i.id !== e.id); })}><Trash2 size={14} /></button>
        </li>
      ))}
    </ol>
  );
}
