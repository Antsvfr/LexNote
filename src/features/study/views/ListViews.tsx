import { Check, ChevronLeft, ChevronRight, Plus, RotateCw, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { newId } from '@/lib/ids';
import { DIFFICULTY_LABELS, QUIZ_KIND_LABELS, difficultySchema, type Difficulty, type FlashcardsContent, type MethodContent, type QuizContent, type TimelineContent } from '@/domain/study';
import { Sources } from './Sources';

const DIFFS = difficultySchema.options;
const Diff = ({ d }: { d: Difficulty }) => <span className={`diff diff--${d}`} data-testid="difficulty">{DIFFICULTY_LABELS[d]}</span>;

/** Flashcards : mode révision (retourner / suivant) + liste modifiable. Chaque carte répond à « Pourquoi cette flashcard ? » via sa source. */
export function FlashcardsView({ content, onChange, showSources }: { content: FlashcardsContent; onChange(c: FlashcardsContent): void; showSources: boolean }) {
  const [k, setK] = useState(0); const [flip, setFlip] = useState(false);
  const cur = content.cards[Math.min(k, content.cards.length - 1)];
  const upd = (fn: (c: FlashcardsContent) => void) => { const c = structuredClone(content); fn(c); onChange(c); };
  const go = (n: number) => { setK((k + n + content.cards.length) % content.cards.length); setFlip(false); };
  return (
    <div className="cards" data-testid="flashcards">
      {cur && (
        <div className="paper study no-print">
          <button className={`flipcard${flip ? ' is-flip' : ''}`} onClick={() => setFlip(!flip)} aria-label="Retourner la carte" data-testid="flipcard">
            <span className="flipcard__side">{flip ? cur.answer : cur.question}</span>
            <small>{flip ? 'Réponse' : 'Question'} · {Math.min(k, content.cards.length - 1) + 1} / {content.cards.length}{cur.concept ? ` · ${cur.concept}` : ''}</small>
          </button>
          <div className="study__nav">
            <button className="btn btn--sm" onClick={() => go(-1)}><ChevronLeft /> Précédente</button>
            <button className="btn btn--sm" onClick={() => setFlip(!flip)}><RotateCw /> Retourner</button>
            <button className="btn btn--sm" onClick={() => go(1)}>Suivante <ChevronRight /></button>
          </div>
          <div className="cards__why">
            <Diff d={cur.difficulty} />
            {showSources && <><span className="muted">Pourquoi cette flashcard ?</span><Sources sources={cur.sources} confidence={cur.confidence} /></>}
          </div>
        </div>
      )}
      <div className="paper list">
        {content.cards.map((c) => (
          <div key={c.id} className="list__row" data-testid="card-row">
            <textarea aria-label="Question" value={c.question} rows={2} onChange={(e) => upd((x) => { x.cards.find((i) => i.id === c.id)!.question = e.target.value || c.question; })} />
            <textarea aria-label="Réponse" value={c.answer} rows={2} onChange={(e) => upd((x) => { x.cards.find((i) => i.id === c.id)!.answer = e.target.value || c.answer; })} />
            <select className="select" aria-label="Difficulté" value={c.difficulty} onChange={(e) => upd((x) => { x.cards.find((i) => i.id === c.id)!.difficulty = e.target.value as Difficulty; })}>{DIFFS.map((d) => <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>)}</select>
            <button className="iconbtn no-print" aria-label="Supprimer la carte" onClick={() => upd((x) => { x.cards = x.cards.filter((i) => i.id !== c.id); })}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn btn--sm no-print" onClick={() => upd((x) => { x.cards.push({ id: newId(), question: 'Question', answer: 'Réponse', difficulty: 'medium', sources: [] }); })}><Plus /> Ajouter une carte</button>
      </div>
    </div>
  );
}

/** Quiz interactif : on répond, on voit la correction + l’explication + la source ; le score est local à cette session de révision. */
export function QuizView({ content, onChange, showSources }: { content: QuizContent; onChange(c: QuizContent): void; showSources: boolean }) {
  const [given, setGiven] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const upd = (fn: (c: QuizContent) => void) => { const c = structuredClone(content); fn(c); onChange(c); };
  const answered = content.questions.filter((q) => given[q.id] !== undefined);
  const score = useMemo(() => content.questions.filter((q) => given[q.id] !== undefined && (q.kind === 'short' ? given[q.id] === 'known' : given[q.id] === q.correct)).length, [content, given]);
  return (
    <div className="paper list" data-testid="quiz">
      <div className="quiz__bar no-print">
        <span data-testid="quiz-score">Score : {score} / {answered.length} <span className="muted">({content.questions.length} questions)</span></span>
        <span className="spacer" />
        <button className="btn btn--sm btn--ghost" onClick={() => setGiven({})}>Recommencer</button>
        <button className="btn btn--sm" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? 'Terminer l’édition' : 'Modifier le quiz'}</button>
      </div>
      {content.questions.map((q, n) => {
        const g = given[q.id]; const done = g !== undefined;
        const ok = q.kind === 'short' ? g === 'known' : g === q.correct;
        const correctText = q.kind === 'mcq' ? q.options?.find((o) => o.id === q.correct)?.text : q.kind === 'truefalse' ? (q.correct === 'true' ? 'Vrai' : 'Faux') : q.correct;
        return (
          <div key={q.id} className="quizq" data-testid="quiz-q" data-state={done ? (ok ? 'ok' : 'ko') : 'open'}>
            <strong>{n + 1}.</strong>
            <div className="quizq__body">
              <div className="quizq__meta"><span className="tag">{QUIZ_KIND_LABELS[q.kind]}</span><Diff d={q.difficulty} /></div>
              {editing ? <textarea aria-label="Question" value={q.prompt} rows={2} onChange={(e) => upd((x) => { x.questions.find((i) => i.id === q.id)!.prompt = e.target.value || q.prompt; })} /> : <p className="quizq__prompt">{q.prompt}</p>}
              {q.kind === 'mcq' && (
                <ul className="quizq__opts">
                  {q.options!.map((o) => (
                    <li key={o.id}>
                      <button className={`quizopt${done && o.id === q.correct ? ' is-right' : ''}${done && g === o.id && o.id !== q.correct ? ' is-wrong' : ''}`} disabled={done} onClick={() => setGiven({ ...given, [q.id]: o.id })} data-testid="quiz-option">{o.text}</button>
                    </li>
                  ))}
                </ul>
              )}
              {q.kind === 'truefalse' && !editing && (
                <div className="seg">
                  {(['true', 'false'] as const).map((v) => <button key={v} type="button" disabled={done} className={done && v === q.correct ? 'is-on' : ''} onClick={() => setGiven({ ...given, [q.id]: v })} data-testid={`quiz-${v}`}>{v === 'true' ? 'Vrai' : 'Faux'}</button>)}
                </div>
              )}
              {q.kind === 'short' && !done && <button className="btn btn--sm" onClick={() => setGiven({ ...given, [q.id]: 'reveal' })} data-testid="quiz-reveal">Voir la réponse</button>}
              {q.kind === 'short' && g === 'reveal' && (
                <div className="seg"><button type="button" onClick={() => setGiven({ ...given, [q.id]: 'known' })}><Check size={13} /> Je savais</button><button type="button" onClick={() => setGiven({ ...given, [q.id]: 'unknown' })}><X size={13} /> À revoir</button></div>
              )}
              {(done && g !== 'reveal') || (q.kind === 'short' && g === 'reveal') ? (
                <div className="quizq__a" data-testid="quiz-explain">
                  <strong>{q.kind === 'short' ? 'Réponse attendue' : ok ? 'Bonne réponse' : 'Mauvaise réponse'} : </strong>{correctText}
                  {editing && q.kind === 'short' && <textarea aria-label="Réponse" value={q.correct} rows={2} onChange={(e) => upd((x) => { x.questions.find((i) => i.id === q.id)!.correct = e.target.value || q.correct; })} />}
                  <p className="muted">{q.explanation}</p>
                  {showSources && <Sources sources={q.sources} confidence={q.confidence} />}
                </div>
              ) : null}
            </div>
            <button className="iconbtn no-print" aria-label="Supprimer la question" onClick={() => upd((x) => { x.questions = x.questions.filter((i) => i.id !== q.id); })}><Trash2 size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

export function TimelineView({ content, onChange, showSources }: { content: TimelineContent; onChange(c: TimelineContent): void; showSources: boolean }) {
  const upd = (fn: (c: TimelineContent) => void) => { const c = structuredClone(content); fn(c); onChange(c); };
  return (
    <ol className="paper timeline" data-testid="timeline">
      {content.events.map((e) => (
        <li key={e.id} data-testid="timeline-event">
          <input className="timeline__date" aria-label="Date" value={e.date} onChange={(ev) => upd((x) => { x.events.find((i) => i.id === e.id)!.date = ev.target.value || e.date; })} />
          <div><textarea aria-label="Évènement" value={e.label} rows={2} onChange={(ev) => upd((x) => { x.events.find((i) => i.id === e.id)!.label = ev.target.value || e.label; })} />{showSources && <Sources sources={e.sources} confidence={e.confidence} />}</div>
          <button className="iconbtn no-print" aria-label="Supprimer l’évènement" onClick={() => upd((x) => { x.events = x.events.filter((i) => i.id !== e.id); })}><Trash2 size={14} /></button>
        </li>
      ))}
    </ol>
  );
}

/** Méthode : objectif, étapes, questions à se poser, erreurs fréquentes, checklist cochable (l’état coché est sauvegardé). */
export function MethodView({ content, onChange, showSources }: { content: MethodContent; onChange(c: MethodContent): void; showSources: boolean }) {
  const upd = (fn: (c: MethodContent) => void) => { const c = structuredClone(content); fn(c); onChange(c); };
  type ListKey = 'steps' | 'questions' | 'pitfalls';
  const list = (key: ListKey, title: string, ordered: boolean) => {
    const items = content[key];
    if (!items.length) return null;
    const Tag = ordered ? 'ol' : 'ul';
    return (
      <section className="sheet__sec" data-testid={`method-${key}`}>
        <h2>{title}</h2>
        <Tag className="method__list">
          {items.map((it) => (
            <li key={it.id}>
              <textarea aria-label={title} value={it.text} rows={Math.max(1, Math.ceil(it.text.length / 90))} onChange={(e) => upd((x) => { x[key].find((i) => i.id === it.id)!.text = e.target.value || it.text; })} />
              <span className="sheet__tools no-print">
                {showSources && <Sources sources={it.sources} confidence={it.confidence} />}
                <button className="iconbtn" aria-label="Supprimer" onClick={() => upd((x) => { x[key] = x[key].filter((i) => i.id !== it.id); })}><Trash2 size={13} /></button>
              </span>
            </li>
          ))}
        </Tag>
      </section>
    );
  };
  return (
    <article className="paper sheet" data-testid="method">
      {content.objective && (
        <section className="sheet__sec"><h2>Objectif</h2>
          <textarea aria-label="Objectif" value={content.objective.text} rows={1} onChange={(e) => upd((x) => { x.objective!.text = e.target.value || content.objective!.text; })} />
          {showSources && <Sources sources={content.objective.sources} />}
        </section>
      )}
      {list('steps', 'Étapes', true)}
      {list('questions', 'Questions à se poser', false)}
      {list('pitfalls', 'Erreurs fréquentes', false)}
      {content.checklist.length > 0 && (
        <section className="sheet__sec" data-testid="method-checklist"><h2>Checklist</h2>
          <ul className="method__check">
            {content.checklist.map((c) => (
              <li key={c.id}><label><input type="checkbox" checked={c.done} onChange={(e) => upd((x) => { x.checklist.find((i) => i.id === c.id)!.done = e.target.checked; })} /> {c.text}</label></li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
