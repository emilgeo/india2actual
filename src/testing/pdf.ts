import { createHash } from 'node:crypto';

import type { Line } from '../extract/pdf.js';

/** Letter-size points, close enough to an A4 statement page. */
const PAGE = { width: 595, height: 842 };

/** Small enough that the invented layouts keep their column gaps. */
const FONT_SIZE = 7;

/** The fixed padding the PDF standard security handler mixes into passwords. */
const PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const ascii = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0));

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const md5 = (...parts: Uint8Array[]) =>
  new Uint8Array(createHash('md5').update(join(parts)).digest());

/** RC4, written out because Node's crypto no longer ships it. */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (state[i] as number) + (key[i % key.length] as number)) & 0xff;
    [state[i], state[j]] = [state[j] as number, state[i] as number];
  }

  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let index = 0; index < data.length; index += 1) {
    a = (a + 1) & 0xff;
    b = (b + (state[a] as number)) & 0xff;
    [state[a], state[b]] = [state[b] as number, state[a] as number];
    out[index] =
      (data[index] as number) ^
      (state[((state[a] as number) + (state[b] as number)) & 0xff] as number);
  }
  return out;
}

const paddedPassword = (password: string) =>
  join([new TextEncoder().encode(password), PADDING]).slice(0, 32);

const hex = (bytes: Uint8Array) =>
  [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Write positioned text lines into a minimal PDF, so tests can exercise the
 * real PDF reader without a real statement. Each item is placed in Helvetica
 * at its own x and y, one page per `page` number. With a password the file is
 * encrypted the way older bank statements are (RC4, 40 bit).
 */
export function pdfFromLines(
  lines: Line[],
  options: { password?: string } = {},
): Uint8Array {
  const pageCount = Math.max(1, ...lines.map(line => line.page));
  const fileId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);

  let encryptionKey: Uint8Array | undefined;
  let encryptDictionary = '';
  if (options.password !== undefined) {
    const owner = rc4(
      md5(paddedPassword(options.password)).slice(0, 5),
      paddedPassword(options.password),
    );
    const permissions = Uint8Array.from([0xfc, 0xff, 0xff, 0xff]);
    encryptionKey = md5(
      paddedPassword(options.password),
      owner,
      permissions,
      fileId,
    ).slice(0, 5);
    const user = rc4(encryptionKey, PADDING);
    encryptDictionary =
      `<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> ` +
      '/P -4 >>';
  }

  // 1: catalog, 2: page tree, 3: font, then a page and a content stream each,
  // then the encryption dictionary when there is one.
  const firstPage = 4;
  const kids = Array.from(
    { length: pageCount },
    (_, index) => `${firstPage + index * 2} 0 R`,
  ).join(' ');
  const objects: Uint8Array[] = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`),
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];

  for (let page = 1; page <= pageCount; page += 1) {
    const content = ascii(
      lines
        .filter(line => line.page === page)
        .flatMap(line => line.items)
        .map(
          item =>
            `BT /F1 ${FONT_SIZE} Tf ${item.x} ${item.y} Td (${escapeText(item.text)}) Tj ET`,
        )
        .join('\n'),
    );

    const contentId = firstPage + (page - 1) * 2 + 1;
    const stored = encryptionKey
      ? rc4(
          md5(
            encryptionKey,
            Uint8Array.from([contentId & 0xff, (contentId >> 8) & 0xff, 0, 0, 0]),
          ).slice(0, 10),
          content,
        )
      : content;

    objects.push(
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
          `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    objects.push(
      join([
        ascii(`<< /Length ${stored.length} >>\nstream\n`),
        stored,
        ascii('\nendstream'),
      ]),
    );
  }

  const encryptId = objects.length + 1;
  if (encryptDictionary) {
    objects.push(ascii(encryptDictionary));
  }

  const parts: Uint8Array[] = [ascii('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const piece = join([ascii(`${index + 1} 0 obj\n`), object, ascii('\nendobj\n')]);
    parts.push(piece);
    length += piece.length;
  }

  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    trailer += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  trailer +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R` +
    (encryptDictionary
      ? ` /Encrypt ${encryptId} 0 R /ID [<${hex(fileId)}> <${hex(fileId)}>]`
      : '') +
    ` >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(ascii(trailer));

  return join(parts);
}
