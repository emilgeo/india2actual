import type { Line } from '../extract/pdf.js';

/** Letter-size points, close enough to an A4 statement page. */
const PAGE = { width: 595, height: 842 };

/** Small enough that the invented layouts keep their column gaps. */
const FONT_SIZE = 7;

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Write positioned text lines into a minimal PDF, so tests can exercise the
 * real PDF reader without a real statement. Each item is placed in Helvetica
 * at its own x and y, one page per `page` number.
 */
export function pdfFromLines(lines: Line[]): Uint8Array {
  const pageCount = Math.max(1, ...lines.map(line => line.page));
  const objects: string[] = [];

  // 1: catalog, 2: page tree, 3: font, then a page and a content stream each.
  const firstPage = 4;
  const kids = Array.from(
    { length: pageCount },
    (_, index) => `${firstPage + index * 2} 0 R`,
  ).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (let page = 1; page <= pageCount; page += 1) {
    const content = lines
      .filter(line => line.page === page)
      .flatMap(line => line.items)
      .map(
        item =>
          `BT /F1 ${FONT_SIZE} Tf ${item.x} ${item.y} Td (${escapeText(item.text)}) Tj ET`,
      )
      .join('\n');

    const contentId = firstPage + (page - 1) * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}
