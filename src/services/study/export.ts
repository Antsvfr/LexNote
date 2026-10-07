/** Export des supports : Markdown (fiches, tableaux, listes), SVG/PNG haute résolution (cartes, schémas), impression (PDF via le navigateur). */
import type { SourceReference } from '@/domain/course';
import {
  ARTIFACT_LABELS, DIAGRAM_LABELS, DIFFICULTY_LABELS, QUIZ_KIND_LABELS, type DiagramContent, type FlashcardsContent, type MethodContent, type MindMapContent, type MindNode, type QuizContent,
  type SheetContent, type StudyArtifact, type TableContent, type TimelineContent,
} from '@/domain/study';
import { describeLocation, describeRefs } from '@/services/engine/sourceLabels';
import { DNODE_H, DNODE_W, layoutDiagram, layoutMindMap } from './layout';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const sourceLabel = (s: SourceReference) => `${describeLocation(s.location)}${s.quote ? ` — « ${s.quote.slice(0, 80)}${s.quote.length > 80 ? '…' : ''} »` : ''}`;

/* ------------------------------------------------------------------ Markdown */
export function toMarkdown(a: StudyArtifact, opts: { sources?: boolean } = {}): string {
  const withSrc = opts.sources ?? true;
  const srcLine = (s: SourceReference[]) => (withSrc && s.length ? `\n  *Source : ${describeRefs(s)}*` : '');
  const lines: string[] = [`# ${a.title}`, ''];
  switch (a.type) {
    case 'COURSE_SHEET': {
      for (const sec of (a.content as SheetContent).sections) {
        lines.push(`## ${sec.title}`, '');
        for (const it of sec.items) lines.push(`${'  '.repeat(it.depth ?? 0)}- ${it.label ? `**${it.label}** — ` : ''}${it.text.replace(/\n/g, ' ')}${it.uncertain ? ' *(à vérifier)*' : ''}${srcLine(it.sources)}`);
        lines.push('');
      }
      break;
    }
    case 'MIND_MAP': {
      const walk = (n: MindNode, d: number) => { lines.push(`${'  '.repeat(d)}- ${n.title}${n.uncertain ? ' *(incertain)*' : ''}`); n.children.forEach((c) => walk(c, d + 1)); };
      walk((a.content as MindMapContent).root, 0);
      break;
    }
    case 'COMPARISON_TABLE': {
      const t = a.content as TableContent;
      lines.push(`| | ${t.columns.map((c) => c.title).join(' | ')} |`, `|---|${t.columns.map(() => '---').join('|')}|`);
      for (const r of t.rows) lines.push(`| **${r.label}** | ${t.columns.map((c) => (r.cells[c.id]?.text ?? '—').replace(/\n/g, '<br>').replace(/\|/g, '\\|')).join(' | ')} |`);
      break;
    }
    case 'DIAGRAM': {
      const d = a.content as DiagramContent;
      lines.push(`*${DIAGRAM_LABELS[d.type]}*`, '');
      const label = new Map(d.nodes.map((n) => [n.id, n.label]));
      d.nodes.forEach((n) => lines.push(`- ${n.label}`));
      lines.push('');
      d.edges.forEach((e) => lines.push(`- ${label.get(e.from)} → ${label.get(e.to)}${e.label ? ` (${e.label})` : ''}${e.uncertain ? ' *(incertain)*' : ''}`));
      break;
    }
    case 'TIMELINE': (a.content as TimelineContent).events.forEach((e) => lines.push(`- **${e.date}** — ${e.label}${srcLine(e.sources)}`)); break;
    case 'FLASHCARDS': (a.content as FlashcardsContent).cards.forEach((c) => lines.push(`- **${c.question}** *(${DIFFICULTY_LABELS[c.difficulty]}${c.concept ? ` · ${c.concept}` : ''})*\n  ${c.answer.replace(/\n/g, ' ')}${srcLine(c.sources)}`)); break;
    case 'QUIZ': (a.content as QuizContent).questions.forEach((q, k) => {
      lines.push(`${k + 1}. **${q.prompt}** *(${QUIZ_KIND_LABELS[q.kind]} · ${DIFFICULTY_LABELS[q.difficulty]})*`);
      if (q.options) q.options.forEach((o) => lines.push(`   - ${o.id === q.correct ? '✅' : '▫️'} ${o.text}`));
      lines.push(`   - Réponse : ${q.kind === 'truefalse' ? (q.correct === 'true' ? 'Vrai' : 'Faux') : q.kind === 'mcq' ? q.options?.find((o) => o.id === q.correct)?.text : q.correct.replace(/\n/g, ' ')}`, `   - Explication : ${q.explanation.replace(/\n/g, ' ')}${srcLine(q.sources)}`);
    }); break;
    case 'METHOD': {
      const m = a.content as MethodContent;
      if (m.objective) lines.push(`**Objectif** : ${m.objective.text}`, '');
      const list = (t: string, l: MethodContent['steps'], num = false) => { if (l.length) { lines.push(`## ${t}`, ''); l.forEach((x, k) => lines.push(`${num ? `${k + 1}.` : '-'} ${x.text}${srcLine(x.sources)}`)); lines.push(''); } };
      list('Étapes', m.steps, true); list('Questions à se poser', m.questions); list('Erreurs fréquentes', m.pitfalls);
      if (m.checklist.length) { lines.push('## Checklist', ''); m.checklist.forEach((x) => lines.push(`- [${x.done ? 'x' : ' '}] ${x.text}`)); }
      break;
    }
  }
  return `${lines.join('\n').trim()}\n\n---\n*${ARTIFACT_LABELS[a.type]} générée à partir du cours reconstruit (version ${a.courseVersion}) par LexNote. Vérifiez toujours les références juridiques.*\n`;
}

/* ------------------------------------------------------------------ SVG (indépendant de React : même rendu écran / export / impression) */
const FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
const NODE_STYLE: Record<string, { fill: string; stroke: string }> = {
  root: { fill: '#d4143a', stroke: '#a30f2c' }, section: { fill: '#e8eefc', stroke: '#3b63c9' }, concept: { fill: '#f4f6fb', stroke: '#8a94ad' },
  article: { fill: '#e9f7ef', stroke: '#2e9d64' }, caselaw: { fill: '#f3ecfb', stroke: '#7b4bc2' }, definition: { fill: '#fff4e5', stroke: '#d9822b' },
  example: { fill: '#e6f6fa', stroke: '#2a9bb5' }, important: { fill: '#fdebee', stroke: '#d4143a' }, question: { fill: '#fff9db', stroke: '#c9a400' },
};
export const wrap = (text: string, max: number, lines = 2): string[] => {
  const words = text.split(/\s+/); const out: string[] = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  if (out.length > lines) { const kept = out.slice(0, lines); kept[lines - 1] = `${kept[lines - 1]!.slice(0, max - 1)}…`; return kept; }
  return out;
};
const textLines = (cx: number, cy: number, ls: string[], color: string, size = 13, weight = 500) =>
  ls.map((l, k) => `<text x="${cx}" y="${cy + (k - (ls.length - 1) / 2) * (size + 3) + size / 3}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${color}" font-family="${FONT}">${esc(l)}</text>`).join('');

export function mindMapToSvg(c: MindMapContent, title?: string): string {
  const l = layoutMindMap(c.root, c.orientation);
  const by = new Map(l.nodes.map((n) => [n.node.id, n]));
  const horiz = c.orientation === 'horizontal';
  const links = l.links.map((k) => {
    const a = by.get(k.from)!, b = by.get(k.to)!;
    if (c.orientation === 'radial') return `<path d="M${a.x + a.w / 2},${a.y + a.h / 2} L${b.x + b.w / 2},${b.y + b.h / 2}" stroke="#9aa5c1" stroke-width="1.6" fill="none"/>`;
    const x1 = horiz ? a.x + a.w : a.x + a.w / 2, y1 = horiz ? a.y + a.h / 2 : a.y + a.h, x2 = horiz ? b.x : b.x + b.w / 2, y2 = horiz ? b.y + b.h / 2 : b.y;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${horiz ? mx : x1},${horiz ? y1 : my} ${horiz ? mx : x2},${horiz ? y2 : my} ${x2},${y2}" stroke="#9aa5c1" stroke-width="1.6" fill="none"/>`;
  }).join('');
  const nodes = l.nodes.map((n) => {
    const st = NODE_STYLE[n.node.type] ?? NODE_STYLE.concept!;
    const col = n.node.type === 'root' ? '#fff' : '#1b2233';
    const dash = n.node.uncertain ? ' stroke-dasharray="5 3"' : '';
    const badge = n.hiddenChildren ? `<circle cx="${n.x + n.w}" cy="${n.y + n.h / 2}" r="11" fill="#1b2233"/><text x="${n.x + n.w}" y="${n.y + n.h / 2 + 4}" text-anchor="middle" font-size="11" fill="#fff" font-family="${FONT}">+${n.hiddenChildren}</text>` : '';
    return `<g><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.6"${dash}/>${textLines(n.x + n.w / 2, n.y + n.h / 2, wrap(n.node.title, 26), col)}${badge}</g>`;
  }).join('');
  const top = title ? 34 : 0;
  const head = title ? `<text x="20" y="24" font-size="16" font-weight="700" fill="#1b2233" font-family="${FONT}">${esc(title)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l.width + 20} ${l.height + top + 20}" width="${l.width + 20}" height="${l.height + top + 20}"><rect width="100%" height="100%" fill="#ffffff"/>${head}<g transform="translate(0 ${top})">${links}${nodes}</g></svg>`;
}

export function diagramToSvg(d: DiagramContent, title?: string): string {
  const l = layoutDiagram(d);
  const top = title ? 34 : 0;
  const edges = d.edges.map((e) => {
    const a = l.pos[e.from]!, b = l.pos[e.to]!;
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
    const dash = e.uncertain || e.basis === 'inferred' ? ' stroke-dasharray="6 4"' : '';
    const lab = e.label ? `<text x="${(x1 + x2) / 2 + 6}" y="${(y1 + y2) / 2}" font-size="11" fill="#475069" font-family="${FONT}">${esc(e.label)}${e.uncertain ? ' ?' : ''}</text>` : '';
    return `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}" stroke="#6b7694" stroke-width="1.8" fill="none" marker-end="url(#arr)"${dash}/>${lab}`;
  }).join('');
  const nodes = d.nodes.map((n) => {
    const p = l.pos[n.id]!;
    const fill = n.kind === 'decision' ? '#fff4e5' : n.kind === 'start' ? '#e9f7ef' : n.kind === 'end' ? '#fdebee' : n.kind === 'note' ? '#f4f6fb' : '#e8eefc';
    const stroke = n.kind === 'decision' ? '#d9822b' : n.kind === 'start' ? '#2e9d64' : n.kind === 'end' ? '#d4143a' : '#3b63c9';
    const shape = n.kind === 'decision'
      ? `<polygon points="${p.x + p.w / 2},${p.y - 4} ${p.x + p.w + 6},${p.y + p.h / 2} ${p.x + p.w / 2},${p.y + p.h + 4} ${p.x - 6},${p.y + p.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`
      : `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${n.kind === 'start' || n.kind === 'end' ? 26 : 10}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"${n.uncertain ? ' stroke-dasharray="5 3"' : ''}/>`;
    return `<g>${shape}${textLines(p.x + p.w / 2, p.y + p.h / 2, wrap(n.label, 28, 2), '#1b2233', 12.5)}</g>`;
  }).join('');
  const head = title ? `<text x="20" y="24" font-size="16" font-weight="700" fill="#1b2233" font-family="${FONT}">${esc(title)}</text>` : '';
  const w = Math.max(l.width + 20, 240), h = l.height + top + 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6b7694"/></marker></defs><rect width="100%" height="100%" fill="#ffffff"/>${head}<g transform="translate(0 ${top})">${edges}${nodes}</g></svg>`;
}
void DNODE_W; void DNODE_H;

/** PNG haute résolution (×3 par défaut, adapté à l'impression) à partir d'un SVG. */
export async function svgToPngBlob(svg: string, scale = 3): Promise<Blob> {
  const m = svg.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/);
  const w = Number(m?.[1] ?? 800), h = Number(m?.[2] ?? 600);
  const max = 8000; const k = Math.min(scale, max / Math.max(w, h));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Rendu de l’image impossible.')); img.src = url; });
    const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    const ctx = cv.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Export PNG impossible.'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export const fileSafe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'support';
