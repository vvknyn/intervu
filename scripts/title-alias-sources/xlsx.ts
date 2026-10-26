import { inflateRawSync } from "node:zlib";

/** Minimal .xlsx reader (zip + sharedStrings + sheet XML): enough for the flat title lists the loaders read. No dependency; input is untrusted text, never executed. */

function zipEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`zip entry ${name}: unsupported method ${method}`);
    out.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()],
  );

const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Sheet rows as string arrays (empty cells ""), for the sheet at `sheetPath` (default: first worksheet). */
export function readXlsxRows(buf: Buffer, sheetPath?: string): string[][] {
  const zip = zipEntries(buf);
  const text = (name: string) => zip.get(name)?.toString("utf8") ?? "";
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheet = sheetPath ?? [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheet || !zip.has(sheet)) throw new Error("xlsx: no worksheet found");
  const rows: string[][] = [];
  for (const row of text(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
      const type = /t="(\w+)"/.exec(c[1])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? "")?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2] ?? "")?.[1];
      const value = type === "s" && v !== undefined ? shared[Number(v)] : type === "inlineStr" ? unescapeXml(inline ?? "") : unescapeXml(v ?? "");
      cells[ref ? colIndex(ref) : cells.length] = value;
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}
