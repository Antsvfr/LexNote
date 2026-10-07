import type { AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import { restSelect, restUpsert } from '@/services/supabase/client';
import type { CaptureStorage } from '@/services/capture/storage/types';
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


export async function hydrateCaptureCloud(storage: CaptureStorage): Promise<void> {
  if (!navigator.onLine) return;
  const state = useAuth.getState();
  const token = state.session?.access_token;
  if (!token) return;

  const [sessions, segments, markers, anchors, interruptions] = await Promise.all([
    restSelect<Record<string, unknown>>('transcript_sessions', 'select=*&deleted_at=is.null', token),
    restSelect<Record<string, unknown>>('transcript_segments', 'select=*&deleted_at=is.null&order=start_ms.asc', token),
    restSelect<Record<string, unknown>>('timeline_markers', 'select=*&deleted_at=is.null&order=timestamp_ms.asc', token),
    restSelect<Record<string, unknown>>('note_anchors', 'select=*&deleted_at=is.null&order=timestamp_ms.asc', token),
    restSelect<Record<string, unknown>>('capture_interruptions', 'select=*&order=at_ms.asc', token),
  ]);

  for (const row of sessions) {
    const meta = row.audio_metadata && typeof row.audio_metadata === 'object'
      ? row.audio_metadata as Record<string, unknown>
      : null;
    if (!meta) continue;
    const runs = Array.isArray(meta.runs) ? meta.runs as AudioSession['runs'] : [];
    const a: AudioSession = {
      id: String(row.course_session_id),
      sessionId: String(row.course_session_id),
      originAt: row.started_at ? new Date(String(row.started_at)).getTime() : Date.now(),
      mimeType: String(meta.mimeType ?? 'audio/webm'),
      bitsPerSecond: Number(meta.bitsPerSecond ?? 96000),
      chunkMs: Number(meta.chunkMs ?? 30_000),
      keepAudio: false, // les blobs audio restent volontairement sur l'appareil d'origine
      providerId: row.provider ? String(row.provider) : null,
      runs,
      status: String(row.status ?? 'COMPLETED') as AudioSession['status'],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
    await storage.putAudioSession(a);
  }

  const segs: TranscriptSegment[] = segments.map((row) => ({
    id: String(row.id),
    sessionId: String(row.course_session_id),
    startMs: Number(row.start_ms ?? 0),
    endMs: Number(row.end_ms ?? 0),
    text: String(row.text ?? ''),
    confidence: row.confidence == null ? undefined : Number(row.confidence),
    provider: String(row.provider ?? 'cloud'),
    status: String(row.status ?? 'final') === 'edited' ? 'edited' : 'final',
    source: 'TRANSCRIPTION',
    verification: 'UNVERIFIED',
    createdAt: String(row.created_at),
  }));
  await storage.putSegments(segs);

  for (const row of markers) {
    const reasons = Array.isArray(row.reasons) ? row.reasons as TimelineMarker['reasons'] : [];
    await storage.putMarker({
      id: String(row.id),
      sessionId: String(row.course_session_id),
      atMs: Number(row.timestamp_ms ?? 0),
      reasons,
      note: row.note ? String(row.note) : undefined,
      createdAt: String(row.created_at),
    });
  }

  const anchorRows: NoteAnchor[] = anchors.map((row) => {
    const pos = row.note_position && typeof row.note_position === 'object'
      ? row.note_position as Record<string, unknown>
      : {};
    return {
      id: String(row.id),
      sessionId: String(row.course_session_id),
      timestamp: Number(row.timestamp_ms ?? 0),
      notePosition: Number(pos.position ?? 0),
      textSnippet: String(pos.snippet ?? ''),
      nearbyTranscriptSegmentIds: Array.isArray(row.nearby_transcript_segment_ids)
        ? row.nearby_transcript_segment_ids.map(String)
        : [],
      createdAt: String(row.created_at),
    };
  });
  await storage.putAnchors(anchorRows);

  for (const row of interruptions) {
    await storage.putInterruption({
      id: String(row.id),
      sessionId: String(row.course_session_id),
      atMs: Number(row.at_ms ?? 0),
      kind: String(row.kind ?? 'unknown') as Interruption['kind'],
      message: String(row.message ?? ''),
      recoverable: Boolean(row.recoverable),
      resolvedAtMs: row.resolved_at_ms == null ? undefined : Number(row.resolved_at_ms),
    });
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => { void flushCaptureCloud(); });
