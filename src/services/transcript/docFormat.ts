/**
 * Document en blocs ⇄ Markdown / texte. Sert à l'export, au presse-papiers, et à LIRE la réponse d'un moteur IA
 * (JSON attendu ; Markdown accepté en secours). Rien n'est affiché sans passer par `docSchema` (zod).
 */
import { newId } from '@/lib/ids';
import { CALLOUT_LABELS, CALLOUT_TONES, docSchema, type CalloutTone, type DocBlock, type DocContent } from '@/domain/derived';
import { formatHMS } from '@/domain/capture';

/* ------------------------------------------------------------------ export */
const cellMd = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

export function docToMarkdown(doc: DocContent, opts: { title?: string; footer?: string; timestamps?: boolean } = {}): string {
  const lines: string[] = opts.title ? [`# ${opts.title}`, ''] : [];
  let num = 0;
  for (const b of doc.blocks) {
    const unc = b.uncertain ? ' *(passage incertain)*' : '';
    const at = opts.timestamps && b.startMs !== undefined ? ` *[${formatHMS(b.startMs)}]*` : '';
    if (b.kind !== 'numbered') num = 0;
    switch (b.kind) {
      case 'heading': lines.push(`${'#'.repeat(Math.min(4, (b.level ?? 1) + (opts.title ? 1 : 0)))} ${b.text}`, ''); break;
      case 'paragraph': lines.push(`${b.text}${unc}${at}`, ''); break;
      case 'bullet': lines.push(`${'  '.repeat(b.level ?? 0)}- ${b.text}${unc}`); break;
      case 'numbered': num += 1; lines.push(`${'  '.repeat(b.level ?? 0)}${num}. ${b.text}${unc}`); break;
      case 'definition': lines.push(`**${b.term}** — ${b.text}${unc}`, ''); break;
      case 'callout': lines.push(`> **${CALLOUT_LABELS[b.tone ?? 'info']}** — ${b.text.replace(/\n/g, '\n> ')}`, ''); break;
      case 'question': lines.push(`**Q.** ${b.text}`, ...(b.answer ? [`  *Réponse :* ${b.answer.replace(/\n/g, ' ')}`] : []), ''); break;
      case 'table': {
        const [head, ...rows] = b.rows ?? [];
        if (!head) break;
        if (b.text) lines.push(`*${b.text}*`, '');
        lines.push(`| ${head.map(cellMd).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${head.map((_, i) => cellMd(r[i] ?? '')).join(' | ')} |`), '');
        break;
      }
    }
  }
  const md = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return opts.footer ? `${md}\n\n---\n*${opts.footer}*\n` : `${md}\n`;
}

/** Texte brut (copie, export .txt) : même ordre, sans balises. */
export function docToText(doc: DocContent, opts: { title?: string } = {}): string {
  const out: string[] = opts.title ? [opts.title, '='.repeat(Math.min(60, opts.title.length)), ''] : [];
  let num = 0;
  for (const b of doc.blocks) {
    if (b.kind !== 'numbered') num = 0;
    switch (b.kind) {
      case 'heading': out.push('', b.text.toUpperCase(), ''); break;
      case 'bullet': out.push(`${'  '.repeat(b.level ?? 0)}• ${b.text}`); break;
      case 'numbered': num += 1; out.push(`${'  '.repeat(b.level ?? 0)}${num}. ${b.text}`); break;
      case 'definition': out.push(`${b.term} : ${b.text}`); break;
      case 'callout': out.push(`[${CALLOUT_LABELS[b.tone ?? 'info']}] ${b.text}`); break;
      case 'question': out.push(`Q. ${b.text}`, ...(b.answer ? [`R. ${b.answer}`] : [])); break;
      case 'table': (b.rows ?? []).forEach((r) => out.push(r.join(' | '))); break;
      default: out.push(b.text, '');
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/* ------------------------------------------------------------------ lecture d'une réponse de moteur */
export class InvalidModelOutputError extends Error {
  constructor(message = 'La réponse du moteur IA n’a pas la forme attendue : rien n’a été enregistré. Réessayez.') { super(message); this.name = 'InvalidModelOutputError'; }
}

const TONE_WORDS: Record<string, CalloutTone> = { 'à retenir': 'remember', retenir: 'remember', 'a retenir': 'remember', attention: 'warning', incertain: 'uncertain', 'passage incertain': 'uncertain', note: 'info', 'à noter': 'info' };

/** Markdown simple → blocs (secours si le moteur n'a pas renvoyé de JSON). */
export function markdownToBlocks(md: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  const flush = () => { const t = para.join(' ').trim(); if (t) blocks.push({ id: newId(), kind: 'paragraph', text: t }); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!; const line = raw.trim();
    if (!line || /^-{3,}$/.test(line)) { flush(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); blocks.push({ id: newId(), kind: 'heading', level: Math.min(3, m[1]!.length), text: m[2]!.trim() }); continue; }
    if (line.startsWith('|')) {
      flush(); const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const r = lines[i]!.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
        if (!r.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(r);
        i++;
      }
      i--;
      if (rows.length >= 2) blocks.push({ id: newId(), kind: 'table', text: '', rows });
      continue;
    }
    if ((m = line.match(/^>\s*(?:\*\*([^*]+)\*\*\s*[—:-]?\s*)?(.*)$/))) {
      flush(); const tone = TONE_WORDS[(m[1] ?? '').toLowerCase().trim()] ?? 'info';
      if (m[2]!.trim()) blocks.push({ id: newId(), kind: 'callout', tone, text: m[2]!.trim() });
      continue;
    }
    if ((m = raw.match(/^(\s*)[-*•]\s+(.*)$/))) { flush(); blocks.push({ id: newId(), kind: 'bullet', level: Math.min(3, Math.floor(m[1]!.length / 2)), text: m[2]!.trim() }); continue; }
    if ((m = raw.match(/^(\s*)\d+[.)]\s+(.*)$/))) { flush(); blocks.push({ id: newId(), kind: 'numbered', level: Math.min(3, Math.floor(m[1]!.length / 2)), text: m[2]!.trim() }); continue; }
    if ((m = line.match(/^\*\*([^*]{1,120})\*\*\s*[—:–-]\s*(.+)$/))) { flush(); blocks.push({ id: newId(), kind: 'definition', term: m[1]!.trim(), text: m[2]!.trim() }); continue; }
    para.push(line);
  }
  flush();
  return blocks.map((b) => ({ ...b, text: b.text.replace(/\*\*([^*]+)\*\*/g, '$1') }));
}

/** Blocs renvoyés par un moteur : identifiants régénérés, champs nettoyés, puis validation stricte. */
function normalizeBlocks(raw: unknown[]): DocBlock[] {
  return raw.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const b = x as Record<string, unknown>;
    const kind = String(b.kind ?? 'paragraph');
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    const tone = typeof b.tone === 'string' && (CALLOUT_TONES as readonly string[]).includes(b.tone) ? (b.tone as CalloutTone) : undefined;
    const block: Record<string, unknown> = { id: newId(), kind, text };
    if (typeof b.level === 'number') block.level = Math.max(0, Math.min(3, Math.round(b.level)));
    if (typeof b.term === 'string' && b.term.trim()) block.term = b.term.trim();
    if (tone) block.tone = tone;
    if (typeof b.answer === 'string' && b.answer.trim()) block.answer = b.answer.trim();
    if (Array.isArray(b.rows)) block.rows = (b.rows as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? '')));
    if (b.uncertain === true) block.uncertain = true;
    if (typeof b.startMs === 'number' && b.startMs >= 0) block.startMs = Math.round(b.startMs);
    if (kind === 'callout' && !tone) block.tone = 'info';
    if (kind === 'definition' && !block.term) return text ? [{ id: newId(), kind: 'paragraph', text }] : [];
    if (kind !== 'table' && !text) return [];
    return [block as DocBlock];
  });
}

/** Réponse d'un moteur → document validé. JSON `{ blocks: [...] }` attendu ; Markdown accepté en secours. */
export function parseModelDoc(raw: string, language: string): DocContent {
  const trimmed = raw.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let blocks: DocBlock[] | null = null;
  if (unfenced.startsWith('{')) {
    // Le moteur a voulu répondre en JSON : il DOIT être conforme (pas de repli silencieux sur du texte).
    try {
      const obj = JSON.parse(unfenced) as { blocks?: unknown };
      if (Array.isArray(obj.blocks)) blocks = normalizeBlocks(obj.blocks);
    } catch { /* JSON invalide */ }
    if (!blocks) throw new InvalidModelOutputError();
  } else {
    if (/^<[^>]+>|<<</.test(unfenced)) throw new InvalidModelOutputError();
    blocks = markdownToBlocks(unfenced);
  }
  const res = docSchema.safeParse({ language, blocks });
  if (!res.success || !res.data.blocks.length) throw new InvalidModelOutputError();
  return res.data;
}
