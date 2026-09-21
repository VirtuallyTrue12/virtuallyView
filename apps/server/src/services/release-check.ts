export interface ReleaseDates {
  status?: string | undefined;
  inCinemas?: string | undefined;
  digitalRelease?: string | undefined;
  physicalRelease?: string | undefined;
}

export interface TitleWarning {
  code: 'in-cinemas' | 'camera-copy' | 'suspect-file';
  message: string;
}

const CAMERA_QUALITIES = /^(cam|telesync|telecine|workprint|dvdscr|regional)/i;

const passed = (date: string | undefined, now: number) => !!date && Date.parse(date) <= now;
const day = (date: string | undefined) => (date ? new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : undefined);

/** No digital or disc release yet: anything that exists is a recording made in a cinema. */
export function isStillInCinemas(release: ReleaseDates, now = Date.now()): boolean {
  if (release.status === 'released') return false;
  // Nothing known at all is not evidence either way: do not warn.
  if (!release.status && !release.inCinemas && !release.digitalRelease && !release.physicalRelease) return false;
  return !passed(release.digitalRelease, now) && !passed(release.physicalRelease, now);
}

export function cinemaNotice(release: ReleaseDates, now = Date.now()): string {
  const expected = day(release.digitalRelease ?? release.physicalRelease);
  const later = `${expected ? ` (expected around ${expected})` : ''}`;
  if (release.inCinemas && Date.parse(release.inCinemas) > now) {
    return `This film is not in cinemas until ${day(release.inCinemas)}, so no real copy exists yet. Anything found before then is fake or a leak. `
      + `You can wait instead: it is added now and a proper copy is downloaded automatically once one appears${later}.`;
  }
  return 'This title has not had a home release yet, so the only copies that exist are camera recordings made in a cinema. '
    + `The picture and sound are poor. You can wait instead: it is added now and a proper copy is downloaded automatically once one appears${later}.`;
}

/**
 * Problems worth telling the viewer about for a title that already has a file.
 * A file much shorter or longer than the film is almost always a mislabeled
 * release, and a "WEB" or disc rip that predates the home release cannot be real.
 */
export function warningsFor(movie: {
  quality?: string;
  runtime?: number;
  release?: ReleaseDates;
  fileInfo?: { runtimeSeconds?: number; path?: string };
}, now = Date.now()): TitleWarning[] {
  const warnings: TitleWarning[] = [];
  if (!movie.fileInfo?.path) return warnings;
  const expected = movie.runtime ? movie.runtime * 60 : 0;
  const actual = movie.fileInfo.runtimeSeconds ?? 0;
  if (expected > 0 && actual > 0 && (actual < expected * 0.75 || actual > expected * 1.5)) {
    warnings.push({
      code: 'suspect-file',
      message: `This file runs ${Math.round(actual / 60)} minutes but the film is about ${Math.round(expected / 60)}. It is probably the wrong video under the right name. You can replace it and search again.`
    });
  }
  const early = movie.release ? isStillInCinemas(movie.release, now) : false;
  if (movie.quality && CAMERA_QUALITIES.test(movie.quality)) {
    warnings.push({ code: 'camera-copy', message: 'This is a camera recording made in a cinema. A better copy is downloaded automatically once one is released.' });
  } else if (early && !warnings.length && movie.quality && /^(web|bluray|remux|hdtv|dvd)/i.test(movie.quality)) {
    warnings.push({
      code: 'suspect-file',
      message: `The file is labeled ${movie.quality}, but the film has not had a home release yet, so that label is false. It may be a camera recording or a different video.`
    });
  }
  return warnings;
}
