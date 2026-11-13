import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const scratch = mkdtempSync(path.join(tmpdir(), 'vv-books-unit-'));
process.env.VV_DATA_DIR = path.join(scratch, 'data');
process.env.VV_BOOKS_DIR = path.join(scratch, 'books');
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

import { COVER, epubBytes, makeZip } from './fixtures/books-zip.js';

describe('EPUB reading', () => {
  test('title, author, subjects, description and cover come out of the OPF', async () => {
    const { readEpub } = await import('../../apps/server/src/services/books/epub.js');
    const file = path.join(scratch, 'a.epub');
    writeFileSync(file, epubBytes());
    const r = readEpub(file)!;
    expect(r.meta).toMatchObject({ title: 'Meditations & Letters', authors: ['Marcus Aurelius'], language: 'en', subjects: ['Stoics -- Early works', 'Philosophy, Ancient'], description: 'A private notebook.' });
    expect(r.cover?.bytes.equals(COVER)).toBe(true);
    expect(r.cover?.type).toBe('image/jpeg');
  });
  test('a zip that is not an EPUB, and junk, are rejected', async () => {
    const { readEpub, looksLikeEpub } = await import('../../apps/server/src/services/books/epub.js');
    writeFileSync(path.join(scratch, 'b.zip'), makeZip({ 'x.txt': 'hi' }));
    writeFileSync(path.join(scratch, 'c.epub'), 'not a zip');
    expect(readEpub(path.join(scratch, 'b.zip'))).toBeNull();
    expect(looksLikeEpub(path.join(scratch, 'c.epub'))).toBe(false);
  });
});

describe('library index', () => {
  test('finds ebooks, groups formats, treats a folder of mp3s as one audiobook, and uses metadata.json', async () => {
    const lib = await import('../../apps/server/src/services/books/index.js');
    const root = process.env.VV_BOOKS_DIR!;
    mkdirSync(path.join(root, 'Marcus Aurelius', 'Meditations (180)'), { recursive: true });
    writeFileSync(path.join(root, 'Marcus Aurelius', 'Meditations (180)', 'Meditations.epub'), epubBytes());
    writeFileSync(path.join(root, 'Marcus Aurelius', 'Meditations (180)', 'Meditations.pdf'), '%PDF-1.4');
    mkdirSync(path.join(root, 'Homer', 'The Odyssey'), { recursive: true });
    for (const n of ['10.mp3', '2.mp3', '1.mp3']) writeFileSync(path.join(root, 'Homer', 'The Odyssey', n), 'x');
    writeFileSync(path.join(root, 'Homer', 'The Odyssey', 'metadata.json'), JSON.stringify({ source: 'librivox', sourceId: '77', title: 'The Odyssey (audio)', subjects: ['Epic poetry'] }));
    mkdirSync(path.join(root, 'loose'), { recursive: true });
    writeFileSync(path.join(root, 'loose', 'some_book.txt'), 'hello');
    lib.resetLibraryCache();
    const all = lib.libraryRecords(true);
    expect(all).toHaveLength(3);
    const med = all.find(b => b.kind === 'ebook' && b.authors.includes('Marcus Aurelius'))!;
    expect(med.title).toBe('Meditations & Letters');
    expect(med.files.map(f => f.format)).toEqual(['epub', 'pdf']);
    expect(med.hasCover).toBe(true);
    expect(lib.coverOf(med)?.mime).toBe('image/jpeg');
    const audio = all.find(b => b.kind === 'audiobook')!;
    expect(audio).toMatchObject({ title: 'The Odyssey (audio)', authors: ['Homer'], source: 'librivox', sourceId: '77' });
    expect(audio.files.map(f => f.name)).toEqual(['1.mp3', '2.mp3', '10.mp3']);
    expect(all.find(b => b.path === 'loose/some_book.txt')?.title).toBe('some book');
    // The id does not change between scans, and files are only handed out from inside the folder.
    expect(lib.libraryRecords(true).find(b => b.path === med.path)?.id).toBe(med.id);
    expect(lib.fileOf(med, 0)?.abs).toBe(path.join(root, med.path));
    expect(lib.fileOf(med, 9)).toBeNull();
    expect(lib.matchLibrary('The Meditations & Letters', ['Aurelius, Marcus'])).toBe(med.id);
    expect(lib.matchLibrary('Other', [], 'librivox', '77')).toBe(audio.id);
    expect(lib.matchLibrary('Something Else', ['Someone'])).toBeUndefined();
  });
  test('path pieces cannot escape or break a file system', async () => {
    const { sanitizeSegment } = await import('../../apps/server/src/services/books/index.js');
    expect(sanitizeSegment('../../etc/passwd')).toBe('etc passwd');
    expect(sanitizeSegment('..')).toBe('Unknown');
    expect(sanitizeSegment('a/b\\c:d*e?"<>|\u0000f')).toBe('a b c d e f');
    expect(sanitizeSegment('Title...  ')).toBe('Title');
    expect(sanitizeSegment('x'.repeat(300)).length).toBe(90);
  });
});

describe('source parsers', () => {
  test('Gutendex', async () => {
    const { parseGutendex, flipName } = await import('../../apps/server/src/services/books/sources.js');
    const r = parseGutendex({ results: [
      { id: 2680, title: 'Meditations', authors: [{ name: 'Marcus Aurelius, Emperor of Rome' }, { name: 'Long, George' }], subjects: ['Stoics'], bookshelves: ['Philosophy'], languages: ['en'],
        formats: { 'application/epub+zip': 'https://www.gutenberg.org/ebooks/2680.epub3.images', 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/2680.txt.utf-8', 'image/jpeg': 'https://www.gutenberg.org/cache/epub/2680/pg2680.cover.medium.jpg', 'application/octet-stream': 'x.zip' } },
      { id: 1, title: 'No files', formats: {} }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ source: 'gutenberg', id: '2680', title: 'Meditations', language: 'en', subjects: ['Stoics', 'Philosophy'], media: 'ebook' });
    expect(r[0]!.authors).toEqual(['Marcus Aurelius', 'George Long']);
    expect(r[0]!.formats.map(f => f.kind)).toEqual(['epub', 'txt']);
    expect(r[0]!.cover).toMatch(/^\/api\/books\/cover\?u=https%3A%2F%2Fwww\.gutenberg\.org/);
    expect(flipName('Tolstoy, Leo, graf')).toBe('Leo Tolstoy');
    expect(flipName('Marcus Aurelius, Emperor of Rome, 121-180')).toBe('Marcus Aurelius');
    expect(flipName('Plato')).toBe('Plato');
  });
  test('Gutenberg catalog feed (used when Gutendex is down)', async () => {
    const { parseGutenbergSearchOpds, parseGutenbergBookOpds } = await import('../../apps/server/src/services/books/sources.js');
    const search = parseGutenbergSearchOpds(`<feed><entry><id>https://www.gutenberg.org/ebooks/2680.opds</id><title>Meditations</title><content type="text">Emperor of Rome Marcus Aurelius</content></entry><entry><title>no id</title></entry></feed>`);
    expect(search).toHaveLength(1);
    expect(search[0]).toMatchObject({ id: '2680', title: 'Meditations', formats: [{ kind: 'epub' }, { kind: 'txt' }] });
    expect(search[0]!.urls.epub).toBe('https://www.gutenberg.org/ebooks/2680.epub3.images');
    const book = parseGutenbergBookOpds(`<feed><title>Meditations by Someone</title><entry><title>Meditations</title><content type="xhtml"><div><p>Summary: A "private" notebook. (This is an automatically generated summary.)</p><p>Language: English</p><p>Subject: Stoics</p><p>Subject: Ethics</p></div></content><published>2001-06-01T00:00:00+00:00</published><author><name>Marcus Aurelius, Emperor of Rome</name></author></entry></feed>`, '2680')!;
    expect(book).toMatchObject({ title: 'Meditations', authors: ['Marcus Aurelius'], language: 'en', subjects: ['Stoics', 'Ethics'], description: 'A "private" notebook.' });
    expect(parseGutenbergBookOpds('<feed></feed>', '1')).toBeNull();
  });
  test('Internet Archive search and metadata', async () => {
    const { parseArchiveSearch, parseArchiveMetadata } = await import('../../apps/server/src/services/books/sources.js');
    const s = parseArchiveSearch({ response: { docs: [{ identifier: 'artofwar', title: 'The Art of War', creator: 'Sun Tzu', year: '1910', subject: ['War', 'Strategy'], format: ['EPUB', 'Text PDF', 'DjVu'], description: ['<p>Old</p>'] }, { identifier: 'x', title: 'Scan only', format: ['JPEG'] }] } });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ source: 'archive', id: 'artofwar', authors: ['Sun Tzu'], year: 1910, description: 'Old' });
    expect(s[0]!.formats.map(f => f.kind)).toEqual(['epub', 'pdf']);
    const m = parseArchiveMetadata({ metadata: { title: 'The Art of War', creator: 'Sun Tzu', date: '1910-01-01', 'access-restricted-item': 'true' }, files: [{ name: 'a.pdf', format: 'Text PDF', size: '1234' }, { name: 'a_djvu.xml', format: 'Djvu XML' }, { name: 'a.epub', format: 'EPUB', size: '99' }, { name: 'enc.pdf', format: 'Encrypted PDF' }] });
    expect(m).toMatchObject({ title: 'The Art of War', year: 1910, restricted: true });
    expect(m!.files).toEqual([{ name: 'a.pdf', kind: 'pdf', size: 1234 }, { name: 'a.epub', kind: 'epub', size: 99 }]);
    expect(parseArchiveMetadata({})).toBeNull();
  });
  test('Open Library keeps only free-to-read scans', async () => {
    const { parseOpenLibrary } = await import('../../apps/server/src/services/books/sources.js');
    const r = parseOpenLibrary({ docs: [{ title: 'Gilgamesh', author_name: ['Anon'], first_publish_year: 1900, ia: ['epicofgilgamesh00', 'b'], ebook_access: 'public', cover_i: 55, subject: ['Epic'] }, { title: 'Borrow only', ia: ['z'], ebook_access: 'borrowable' }, { title: 'No scan', ebook_access: 'public' }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ source: 'openlibrary', id: 'epicofgilgamesh00', year: 1900 });
    expect(r[0]!.cover).toContain('covers.openlibrary.org');
  });
  test('arXiv Atom', async () => {
    const { parseArxiv } = await import('../../apps/server/src/services/books/sources.js');
    const xml = `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published><title>Attention Is
 All You Need</title><summary>The dominant   models</summary><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author><category term="cs.CL"/><category term="cs.LG"/></entry>
<entry><id>http://arxiv.org/abs/hep-th/9901001v1</id><title>Old style</title><summary>s</summary></entry></feed>`;
    const r = parseArxiv(xml);
    expect(r[0]).toMatchObject({ id: '1706.03762', title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, subjects: ['cs.CL', 'cs.LG'], description: 'The dominant models', media: 'paper' });
    expect(r[1]!.id).toBe('hep-th/9901001');
  });
  test('LibriVox', async () => {
    const { parseLibrivox } = await import('../../apps/server/src/services/books/sources.js');
    const r = parseLibrivox({ books: [{ id: '12', title: 'The Art of War', description: '<p>Short</p>', language: 'English', copyright_year: '1910', url_zip_file: 'https://archive.org/download/x/x_64kb_mp3.zip', totaltimesecs: 3600, authors: [{ first_name: 'Sun', last_name: 'Tzu' }], genres: [{ name: 'War' }] }, { id: '13', title: 'No zip' }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ source: 'librivox', id: '12', authors: ['Sun Tzu'], durationSec: 3600, media: 'audiobook', subjects: ['War'], zipUrl: 'https://archive.org/download/x/x_64kb_mp3.zip' });
    expect(parseLibrivox({ error: 'Audiobooks could not be found' })).toEqual([]);
  });
  test('Prowlarr releases: only live, on-topic torrents, one per title, audio told apart', async () => {
    const { parseReleases } = await import('../../apps/server/src/services/books/sources.js');
    const row = (over: object) => ({ guid: 'g' + Math.random(), title: 'Meditations by Marcus Aurelius [epub]', indexer: 'Internet Archive', size: 5_000_000, seeders: 4, protocol: 'torrent', downloadUrl: 'http://prowlarr/dl', categories: [{ id: 7020 }], ...over });
    const r = parseReleases([row({}), row({ seeders: 9 }), row({ seeders: 0, title: 'Meditations dead' }), row({ title: 'Cooking for beginners' }), row({ protocol: 'usenet' }), row({ title: 'Meditations Marcus Aurelius audiobook', size: 90_000_000, categories: [{ id: 3030 }], magnetUrl: 'magnet:?xt=urn:btih:abc' })], 'Meditations Marcus Aurelius');
    expect(r.map(x => [x.seeders, x.audio])).toEqual([[9, false], [4, true]]);
    expect(r[1]!.downloadUrl).toBe('magnet:?xt=urn:btih:abc');
    expect(parseReleases(null, 'x')).toEqual([]);
  });
});

describe('file checks before anything is filed', () => {
  test('magic bytes decide, not the name', async () => {
    const { checkFile, titleFromRelease } = await import('../../apps/server/src/services/books/pull.js');
    const f = (name: string, data: string | Buffer) => { const p = path.join(scratch, name); writeFileSync(p, data); return p; };
    expect(checkFile(f('ok.epub', epubBytes()), 'epub')).toBeNull();
    expect(checkFile(f('bad.epub', '<html>sign in</html>'), 'epub')).toMatch(/web page/);
    expect(checkFile(f('nozip.epub', 'PK but not'), 'epub')).toMatch(/not a valid EPUB/);
    expect(checkFile(f('ok.pdf', '%PDF-1.7\n...'), 'pdf')).toBeNull();
    expect(checkFile(f('bad.pdf', 'hello'), 'pdf')).toMatch(/not a valid PDF/);
    expect(checkFile(f('ok.zip', makeZip({ 'a.mp3': 'x' })), 'zip')).toBeNull();
    expect(checkFile(f('bad.zip', 'nope'), 'zip')).toMatch(/zip/);
    expect(checkFile(f('ok.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)])), 'mp3')).toBeNull();
    expect(checkFile(f('bad.mp3', 'hello world'), 'mp3')).toMatch(/MP3/);
    expect(checkFile(f('bin.txt', Buffer.from([65, 0, 66])), 'txt')).toMatch(/text/);
    expect(checkFile(f('empty.pdf', ''), 'pdf')).toMatch(/empty/);
    expect(titleFromRelease('Marcus Aurelius - Meditations [2002] (epub).epub')).toEqual({ authors: ['Marcus Aurelius'], title: 'Meditations' });
    expect(titleFromRelease('Some.Book.Title.pdf')).toEqual({ authors: [], title: 'Some Book Title' });
  });
  test('info-hash of a .torrent file', async () => {
    const { torrentInfoHash } = await import('../../apps/server/src/services/books/pull.js');
    const { createHash } = await import('node:crypto');
    const info = 'd6:lengthi5e4:name3:abc12:piece lengthi16384e6:pieces20:' + 'x'.repeat(20) + 'e';
    const torrent = Buffer.from(`d8:announce14:http://t/a?b=c4:infod${info.slice(1)}7:comment2:hie`.replace('d6:length', 'd6:length'), 'latin1');
    expect(torrentInfoHash(torrent)).toBe(createHash('sha1').update(info).digest('hex'));
    expect(torrentInfoHash(Buffer.from('not bencode'))).toBeUndefined();
  });
  test('books are filed under Author/Title (Year) inside the books folder', async () => {
    const { targetFolder } = await import('../../apps/server/src/services/books/pull.js');
    expect(targetFolder(['Sun Tzu'], 'The Art of War', 1910)).toBe(path.join(process.env.VV_BOOKS_DIR!, 'Sun Tzu', 'The Art of War (1910)'));
    expect(targetFolder([], '../../x')).toBe(path.join(process.env.VV_BOOKS_DIR!, 'Unknown Author', 'x'));
  });
});

describe('taste and shelves', () => {
  const card = (id: string, over: Partial<import('../../apps/server/src/services/books/recs.js').BookCard> = {}) => ({ id, kind: 'ebook' as const, title: id, authors: [], subjects: [], hasCover: false, addedAt: 1, files: [], path: id, favorite: false, percent: 0, finished: false, lastOpenedAt: 0, ...over });
  test('topics split subject headings', async () => {
    const { topics } = await import('../../apps/server/src/services/books/recs.js');
    expect(topics(['Philosophy -- Ancient, Stoics', 'Fiction', 'x'])).toEqual(['philosophy', 'ancient', 'stoics']);
  });
  test('because-you-read ranks the nearest book first; continue lists half-read books; finished ones are not suggested', async () => {
    const { buildShelves, engagement } = await import('../../apps/server/src/services/books/recs.js');
    const items = [
      card('meditations', { title: 'Meditations', authors: ['Marcus Aurelius'], subjects: ['Stoics', 'Philosophy'], percent: 100, finished: true, lastOpenedAt: 50 }),
      card('letters', { title: 'Letters from a Stoic', authors: ['Seneca'], subjects: ['Stoics', 'Philosophy'] }),
      card('cooking', { title: 'Cooking', authors: ['Chef'], subjects: ['Cookery', 'Food'] }),
      card('half', { title: 'Half way', subjects: ['Poetry'], percent: 40, lastOpenedAt: 99 }),
      card('b1', { subjects: ['Poetry'] }), card('b2', { subjects: ['Poetry'] })
    ];
    const shelves = buildShelves(items);
    const by = (k: string) => shelves.find(s => s.kind === k);
    expect(by('continue')!.items.map(b => b.id)).toEqual(['half']);
    expect(by('because')!.title).toBe('Because you read Half way');
    expect(by('forYou')!.items.map(b => b.id)[0]).toBe('b1');
    expect(shelves.some(s => s.items.some(b => b.id === 'meditations') && s.kind === 'forYou')).toBe(false);
    expect(engagement({ position: '', percent: 100, finished: true, openedAt: 1, updatedAt: 1 }, true)).toBe(5);
    // Cold start: nothing read yet, so no taste rows, only the library's own shelves.
    expect(buildShelves([card('a'), card('b')]).map(s => s.kind)).toEqual(['recent']);
  });
});

describe('Kids profiles', () => {
  test('cannot search or pull, can read', async () => {
    const { kidsBlocked } = await import('../../apps/server/src/services/kids.js');
    expect(kidsBlocked(true, 'POST', '/api/books/pull')).toBe(true);
    expect(kidsBlocked(true, 'GET', '/api/books/search')).toBe(true);
    expect(kidsBlocked(true, 'GET', '/api/books/jobs')).toBe(true);
    expect(kidsBlocked(true, 'GET', '/api/books/library')).toBe(false);
    expect(kidsBlocked(false, 'POST', '/api/books/pull')).toBe(false);
  });
});
