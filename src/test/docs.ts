import { strToU8, zipSync } from 'fflate';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** .docx minimal valide (paragraphes, titres, sauts de page). */
export function makeDocx(paras: { text: string; heading?: number; pageBreak?: boolean }[]): Uint8Array {
  const body = paras.map((p) => `<w:p>${p.heading ? `<w:pPr><w:pStyle w:val="Heading${p.heading}"/></w:pPr>` : ''}${p.pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ''}<w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`).join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  });
}

/** .pptx minimal valide (titre, corps, notes du présentateur). */
export function makePptx(slides: { title?: string; body?: string[]; notes?: string }[]): Uint8Array {
  const files: Record<string, Uint8Array> = { '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') };
  slides.forEach((s, i) => {
    const n = i + 1;
    const title = s.title ? `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${esc(s.title)}</a:t></a:r></a:p></p:txBody></p:sp>` : '';
    const body = (s.body ?? []).length ? `<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>${s.body!.map((b) => `<a:p><a:r><a:t>${esc(b)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>` : '';
    files[`ppt/slides/slide${n}.xml`] = strToU8(`<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${title}${body}</p:spTree></p:cSld></p:sld>`);
    if (s.notes) {
      files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(`<?xml version="1.0"?><p:notes xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${esc(s.notes)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
      files[`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`] = strToU8(`<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="slide" Target="../slides/slide${n}.xml"/></Relationships>`);
    }
  });
  return zipSync(files);
}

/** PDF minimal valide : une page par chaîne (Helvetica, texte sélectionnable). */
export function makePdf(pages: string[]): Uint8Array {
  const objs: string[] = []; const add = (s: string) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const contents = pages.map((t) => { const stream = `BT /F1 14 Tf 50 700 Td (${t.replace(/[\\()]/g, '\\$&')}) Tj ET`; return add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); });
  const pagesId = objs.length + pages.length + 1;
  const kids = pages.map((_, i) => add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contents[i]} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  const pid = add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pid} 0 R >>`);
  let out = '%PDF-1.4\n'; const off: number[] = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(out, true);
}
export { ab };
