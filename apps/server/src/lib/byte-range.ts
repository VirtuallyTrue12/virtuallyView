/**
 * One `Range: bytes=...` header, per RFC 9110 §14.1.2. There are three shapes:
 *   bytes=500-999   a normal range
 *   bytes=500-      from a point to the end
 *   bytes=-500      a *suffix* range: the last 500 bytes, counted from the end of the file - not
 *                    "byte 0 to 500", which is what treating the missing start as 0 would give.
 * Getting the suffix case wrong silently serves the wrong part of the file (the beginning instead of the
 * end); nothing about it looks like an error, so a player just plays or seeks to the wrong content.
 */
/**
 * An open-ended range ("bytes=500-") means the whole rest of the file, even for a multi-gigabyte video:
 * the response is a stream with TCP backpressure, never read into memory, and the browser stops reading
 * (or cancels and re-ranges on a seek) on its own. Capping it to small chunks forced a fresh request per
 * chunk, which over Wi-Fi or a remote link turned every chunk boundary into a chance to stall.
 */
export function parseByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startPart, endPart] = match;
  const hasStart = startPart !== '';
  const hasEnd = endPart !== '';
  if (!hasStart && !hasEnd) return null;

  let start: number;
  let end: number;
  if (!hasStart) {
    // Suffix range: the last N bytes. A suffix longer than the file just means "the whole file".
    const suffixLength = parseInt(endPart!, 10);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = parseInt(startPart!, 10);
    end = hasEnd ? Math.min(parseInt(endPart!, 10), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}
