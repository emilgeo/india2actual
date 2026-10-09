// Small file writers for the extension build: PNG icons and a zip, with no
// dependency. Only what the build needs.
import { deflateRawSync, deflateSync } from 'node:zlib';

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = n => Buffer.from([n & 0xff, (n >>> 8) & 0xff]);
const u32 = n => Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/** A zip of `{ name, data }` files, deflated, with a fixed date so builds repeat. */
export function zip(files) {
  const date = 0x5821; // 2024-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name);
    const body = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(date),
      u32(crc), u32(body.length), u32(data.length), u16(nameBytes.length), u16(0),
      nameBytes, body,
    ]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(date),
        u32(crc), u32(body.length), u32(data.length), u16(nameBytes.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }

  const central = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ]);
}

/**
 * A square icon: a teal rounded tile with a white arrow pointing right, like a
 * statement going into a budget. Drawn at 4x and averaged for smooth edges.
 */
export function pngIcon(size) {
  const samples = 4;
  const teal = [0x0f, 0x76, 0x6e];
  const inside = (x, y) => {
    // Rounded square.
    const r = 0.22;
    const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
    const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
  const arrow = (x, y) => {
    const shaft = x >= 0.2 && x <= 0.55 && y >= 0.43 && y <= 0.57;
    // A triangle with its tip at (0.8, 0.5).
    const head = x >= 0.5 && x <= 0.8 && Math.abs(y - 0.5) <= (0.8 - x) * (0.27 / 0.3);
    return shaft || head;
  };

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      let tile = 0;
      let white = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / size;
          const py = (y + (sy + 0.5) / samples) / size;
          if (inside(px, py)) {
            tile += 1;
            if (arrow(px, py)) {
              white += 1;
            }
          }
        }
      }
      const total = samples * samples;
      const cover = tile / total;
      const mix = tile ? white / tile : 0;
      const at = y * (size * 4 + 1) + 1 + x * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        raw[at + channel] = Math.round((teal[channel] ?? 0) * (1 - mix) + 255 * mix);
      }
      raw[at + 3] = Math.round(cover * 255);
    }
  }

  const header = Buffer.concat([u32(0), u32(0), Buffer.from([8, 6, 0, 0, 0])]);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  const png = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, check]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    png('IHDR', header),
    png('IDAT', deflateSync(raw)),
    png('IEND', Buffer.alloc(0)),
  ]);
}
