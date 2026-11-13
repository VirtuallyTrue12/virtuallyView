import { crc32, deflateRawSync } from 'node:zlib';

/** A zip file made of the given entries (deflated except `mimetype`, like a real EPUB). */
export function makeZip(entries: Record<string, string | Buffer>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content), stored = name === 'mimetype', data = stored ? raw : deflateRawSync(raw), nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(stored ? 0 : 8, 10);
    cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, nm, data); central.push(cd, nm);
    offset += 30 + nm.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:title>Meditations &amp; Letters</dc:title><dc:creator opf:role="aut">Marcus Aurelius</dc:creator><dc:language>en</dc:language>
<dc:subject>Stoics -- Early works</dc:subject><dc:subject>Philosophy, Ancient</dc:subject><dc:description>&lt;p&gt;A <b>private</b> notebook.&lt;/p&gt;</dc:description>
<dc:date>0180-01-01</dc:date><meta name="cover" content="cvr"/></metadata><manifest><item id="cvr" href="images/cover%201.jpg" media-type="image/jpeg"/></manifest></package>`;
export const COVER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
export const epubBytes = (opf = OPF) => makeZip({ mimetype: 'application/epub+zip', 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>', 'OEBPS/content.opf': opf, 'OEBPS/images/cover 1.jpg': COVER });

