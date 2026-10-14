import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { useArtifacts } from '@/store/artifacts';
import { useAuth } from '@/store/auth';
import { useLibrary } from '@/store/library';
import { toast } from '@/store/toasts';
import { newId } from '@/lib/ids';
import { formatHMS } from '@/domain/capture';
import { DIFFICULTY_LABELS, validateContent, type Difficulty, type FlashcardsContent, type StudyArtifact } from '@/domain/study';
import type { TranscriptProvenance } from '@/domain/derived';

export interface FlashcardRequest { sessionId: string; text: string; range: { startMs: number; endMs: number }; version: string }

const MANUAL = 'manual-flashcard';

/**
 * Flashcard à partir d'un passage : la RÉPONSE est le passage (modifiable), la QUESTION est écrite par l'étudiant.
 * Aucune IA : rien n'est généré à sa place. Les cartes d'une séance sont réunies dans un seul support « Flashcards ».
 */
export function FlashcardDialog({ request, onClose }: { request: FlashcardRequest | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (request) { setQuestion(''); setAnswer(request.text.trim().slice(0, 1500)); setDifficulty('medium'); setBusy(false); } }, [request]);

  async function save() {
    const userId = useAuth.getState().user?.id;
    const session = useLibrary.getState().sessions.find((s) => s.id === request?.sessionId);
    if (!request || !userId || !session || !question.trim() || !answer.trim() || busy) return;
    setBusy(true);
    const card = { id: newId(), question: question.trim(), answer: answer.trim(), difficulty, concept: `Transcription ${formatHMS(request.range.startMs)}`, sources: [] };
    const store = useArtifacts.getState();
    const existing = store.items.find((a) => a.type === 'FLASHCARDS' && a.generationType === MANUAL && a.sourceSessionIds[0] === session.id);
    try {
      if (existing) {
        const content = validateContent('FLASHCARDS', { cards: [...(existing.content as FlashcardsContent).cards, card] });
        await store.edit(existing.id, content);
        toast.success('Flashcard ajoutée.');
        onClose(); navigate(`/supports/${existing.id}`);
      } else {
        const content = validateContent('FLASHCARDS', { cards: [card] });
        const now = new Date().toISOString();
        const generator = { providerId: 'lexnote-manual', model: 'saisie', local: true };
        const provenance: TranscriptProvenance = {
          from: 'transcript', sessionId: session.id, transcriptVersion: request.version, sourceKind: 'selection', range: request.range, generationType: MANUAL,
          generator, language: 'fr', options: {}, inputWords: request.text.split(/\s+/).length, parts: 1, generatedAt: now,
        };
        const art: StudyArtifact = {
          id: newId(), userId, type: 'FLASHCARDS', title: `Mes flashcards — ${session.title || 'Séance'}`.slice(0, 300), subjectId: session.subjectId, sourceSessionIds: [session.id],
          scope: null, settings: {}, content, generatedContent: null, courseId: '', courseVersion: 0, sourceSnapshot: { sources: [], hash: '' } as unknown as StudyArtifact['sourceSnapshot'],
          engineVersion: 'manuel', provenance, generation: 1, userEdited: true, sourceType: 'transcript', generationType: MANUAL, language: 'fr', sourceTranscriptVersion: request.version,
          parentArtifactId: null, generator, revisions: [], createdAt: now, updatedAt: now,
        };
        await store.add(art);
        toast.success('Flashcard créée.');
        onClose(); navigate(`/supports/${art.id}`);
      }
    } catch (e) { toast.error((e as Error).message); setBusy(false); }
  }

  return (
    <Modal open={request !== null} onClose={onClose} title="Créer une flashcard" description="Écrivez la question ; la réponse reprend le passage sélectionné (modifiable)." onSubmit={() => void save()}
      footer={<><button type="button" className="btn" onClick={onClose}>Annuler</button><button type="submit" className="btn btn--primary" disabled={!question.trim() || !answer.trim() || busy} data-testid="flashcard-save">Créer</button></>}>
      {request && (
        <div className="xact" data-testid="flashcard-dialog">
          <p className="muted xact__scope">Passage · {formatHMS(request.range.startMs)} – {formatHMS(request.range.endMs)}</p>
          <div className="field"><label htmlFor="fc-q">Question</label><input id="fc-q" className="input" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={400} autoFocus data-testid="flashcard-question" placeholder="ex. Qu’est-ce que le prix d’équilibre ?" /></div>
          <div className="field"><label htmlFor="fc-a">Réponse</label><textarea id="fc-a" className="input xact__area" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1500} rows={4} /></div>
          <div className="field"><span className="field-label">Difficulté</span>
            <div className="seg" role="radiogroup" aria-label="Difficulté">
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => <button key={d} type="button" role="radio" aria-checked={difficulty === d} className={difficulty === d ? 'is-on' : ''} onClick={() => setDifficulty(d)}>{DIFFICULTY_LABELS[d]}</button>)}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
