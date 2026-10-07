import type { AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import { restUpsert } from '@/services/supabase/client';
import { useAuth } from '@/store/auth';

type CaptureItem =
  | { kind: 'audio'; data: AudioSession }
  | { kind: 'segment'; data: TranscriptSegment }
  | { kind: 'marker'; data: TimelineMarker }
  | { kind: 'anchor'; data: NoteAnchor }
  | { kind: 'interruption'; data: Interruption };

const key = (userId: string) => 'lexnote.capture.sync.' + userId;
let flushing = false;

function read(userId: string): CaptureItem[] {
  try { return JSON.parse(localStorage.getItem(key(userId)) ?? '[]') as CaptureItem[]; }
  catch { return []; }
}

function write(userId: string, items: CaptureItem[]) {
  try { localStorage.setItem(key(userId), JSON.stringify(items)); } catch { /* best effort */ }
}

export function enqueueCaptureCloud(item: CaptureItem) {
  const userId = useAuth.getState().session?.user.id;
  if (!userId) return;
  const items = read(userId);
  items.push(item);
  write(userId, items);
  if (navigator.onLine) void flushCaptureCloud();
}

export async function flushCaptureCloud() {
  if (flushing || !navigator.onLine) return;
  const state = useAuth.getState();
  const userId = state.session?.user.id;
  const token = state.session?.access_token;
  if (!userId || !token) return;
  let items = read(userId);
  if (!items.length) return;
  flushing = true;
  try {
    while (items.length) {
      const item = items[0]!;
      if (item.kind === 'audio') {
        const a = item.data;
        await restUpsert('transcript_sessions', [{
          id: a.sessionId,
          user_id: userId,
          course_session_id: a.sessionId,
          provider: a.providerId,
          status: a.status,
          started_at: a.createdAt,
          ended_at: a.status === 'COMPLETED' ? a.updatedAt : null,
          audio_metadata: {
            mimeType: a.mimeType,
            bitsPerSecond: a.bitsPerSecond,
            chunkMs: a.chunkMs,
            keepAudio: a.keepAudio,
            runs: a.runs,
          },
          created_at: a.createdAt,
          updated_at: a.updatedAt,
          deleted_at: null,
        }], token);
      }
      if (item.kind === 'segment') {
        const s = item.data;
        // La session de transcription est créée paresseusement si la capture fonctionne sans audio conservé.
        await restUpsert('transcript_sessions', [{
          id: s.sessionId,
          user_id: userId,
          course_session_id: s.sessionId,
          provider: s.provider,
          status: 'RECORDING',
          created_at: s.createdAt,
          updated_at: s.createdAt,
          deleted_at: null,
        }], token);
        await restUpsert('transcript_segments', [{
          id: s.id,
          user_id: userId,
          transcript_session_id: s.sessionId,
          course_session_id: s.sessionId,
          sequence: Math.max(0, Math.round(s.startMs)),
          start_ms: s.startMs,
          end_ms: s.endMs,
          text: s.text,
          confidence: s.confidence ?? null,
          provider: s.provider,
          status: s.status,
          created_at: s.createdAt,
          updated_at: s.createdAt,
          deleted_at: null,
        }], token);
      }
      if (item.kind === 'marker') {
        const m = item.data;
        await restUpsert('timeline_markers', [{
          id: m.id,
          user_id: userId,
          course_session_id: m.sessionId,
          marker_type: m.reasons[0]?.toUpperCase() ?? 'IMPORTANT',
          reasons: m.reasons,
          timestamp_ms: m.atMs,
          label: m.reasons.join(', '),
          note: m.note ?? null,
          created_at: m.createdAt,
          updated_at: m.createdAt,
          deleted_at: null,
        }], token);
      }
      if (item.kind === 'anchor') {
        const a = item.data;
        await restUpsert('note_anchors', [{
          id: a.id,
          user_id: userId,
          course_session_id: a.sessionId,
          timestamp_ms: a.timestamp,
          note_position: { position: a.notePosition, snippet: a.textSnippet },
          nearby_transcript_segment_ids: a.nearbyTranscriptSegmentIds,
          created_at: a.createdAt,
          updated_at: a.createdAt,
          deleted_at: null,
        }], token);
      }
      if (item.kind === 'interruption') {
        const i = item.data;
        await restUpsert('capture_interruptions', [{
          id: i.id,
          user_id: userId,
          course_session_id: i.sessionId,
          at_ms: i.atMs,
          kind: i.kind,
          message: i.message,
          recoverable: i.recoverable,
          resolved_at_ms: i.resolvedAtMs ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }], token);
      }
      items.shift();
      write(userId, items);
    }
  } catch {
    // La file reste intacte et sera retentée au prochain événement / retour en ligne.
  } finally {
    flushing = false;
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => { void flushCaptureCloud(); });
