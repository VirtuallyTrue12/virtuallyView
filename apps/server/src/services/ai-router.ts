// Small local models (around 500M parameters) cannot be trusted to pick tools or
// stay on topic. Common questions are therefore answered by rules, without the
// model at all, and the model only sees what the rules cannot handle.

export type Intent =
  | { kind: 'help' }
  | { kind: 'downloads' }
  | { kind: 'diagnose'; subject?: string }
  | { kind: 'library' }
  | { kind: 'requests' }
  | { kind: 'request'; mediaType: 'movie' | 'series' | 'artist'; title: string }
  | { kind: 'retry'; subject: string }
  | { kind: 'download-action'; action: 'pause' | 'resume' | 'remove'; subject: string }
  | { kind: 'subtitles'; subject?: string }
  | { kind: 'themes'; name?: string };

const norm = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Words that mean the question is about this app. Anything without one is off topic. */
const TOPIC = /\b(movies?|films?|shows?|series|tv|episodes?|seasons?|songs?|music|artists?|bands?|albums?|tracks?|downloads?|downloading|torrents?|queue|requests?|requested|subtitles?|captions?|themes?|library|libraries|server|services?|radarr|sonarr|lidarr|prowlarr|bazarr|qbittorrent|nzbget|ollama|indexers?|quality|profiles?|watch|play|playing|playback|stream|streaming|search|missing|failed|failing|error|errors|status|health|disk|space|storage|account|users?|password|sign ?in|backup|restore|notifications?|settings?|help|retry|pause|resume|remove|cancel|approve|health)\b/;

export function inScope(text: string): boolean {
  return TOPIC.test(norm(text));
}

const TITLE_AFTER = /(?:pause|resume|remove|delete|cancel|retry|re-?search|search again|try again|find again|redownload|re-download|subtitles? (?:for|of)|debug|why (?:is|isn't|isnt|are|aren't|arent|won't|wont|does|doesn't|doesnt|do|don't|dont)|what'?s wrong with|fix)\s+(?:the\s+)?(?:download of\s+|search for\s+|request for\s+)?["“]?(.+?)["”]?\s*(?:\?|$)/;
/** Where the title ends and the complaint begins: "linkin park not showing any tracks". */
const COMPLAINT = /\s+(?:is |are |was |were )?(?:not|isn't|isnt|aren't|arent|won't|wont|doesn't|doesnt|don't|dont|no|any|missing|failing|failed|stuck|broken|showing|working|loading|playing|downloading|appearing|importing|available|found|there)\b.*$/;

function subjectOf(text: string): string {
  const match = TITLE_AFTER.exec(text);
  let raw = match?.[1] ?? '';
  raw = raw.replace(COMPLAINT, '');
  raw = raw.replace(/\b(please|now|again|download|downloading|downloaded|working|loading|showing|playing|tracks?|episodes?|songs?|movie|film|show|series|artist|album)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return raw;
}

export function detectIntent(input: string): Intent | null {
  const text = norm(input);
  if (!text) return null;

  if (/^(help|\/help|\?)$|what can you (do|help)|what do you do|how (do|can) i (use|talk)|commands|capabilities/.test(text)) return { kind: 'help' };

  const request = /^(?:please |can you |could you )?(?:request|add|get me|download|find)\s+(?:the\s+)?(?:(movie|film|series|show|tv show|artist|band|album)\s+)?["“]?(.+?)["”]?\s*$/i.exec(input.replace(/\s+/g, " ").trim());
  if (request && !/\b(status|progress|queue|list|all)\b/.test(text) && request[2] && !/^(my |the )?(downloads?|requests?)\b/.test(request[2])) {
    const word = (request[1] ?? '').toLowerCase();
    const mediaType = /series|show|tv/.test(word) ? 'series' : /artist|band|album/.test(word) ? 'artist' : 'movie';
    return { kind: 'request', mediaType, title: request[2].replace(/^(?:the )?(?:movie|film|series|show|artist|band)\s+/i, '').trim() };
  }

  const action = /^(?:please )?(pause|resume|remove|delete|cancel)\s+(?:the\s+)?(?:download\s+(?:of\s+)?)?(.+)$/.exec(text);
  if (action && action[2] && !/\brequest\b/.test(action[2])) {
    const verb = action[1] === 'delete' || action[1] === 'cancel' ? 'remove' : action[1] as 'pause' | 'resume' | 'remove';
    return { kind: 'download-action', action: verb, subject: action[2].trim() };
  }

  if (/\b(retry|re-?search|search again|try again|find again|redownload|re-download|get it again)\b/.test(text)) {
    return { kind: 'retry', subject: subjectOf(text) };
  }

  if (/\bsubtitles?\b|\bcaptions?\b/.test(text)) return { kind: 'subtitles', subject: subjectOf(text) };

  if (/\b(theme|themes)\b/.test(text)) {
    const named = /(?:to|use|switch to|change to|set to)\s+(?:the\s+)?(.+?)\s*(?:theme)?\s*$/.exec(text);
    return { kind: 'themes', ...(named?.[1] && !/^themes?$/.test(named[1]) ? { name: named[1] } : {}) };
  }

  const trouble = /\b(why|debug|diagnos\w*|troubleshoot|not (?:working|loading|showing|downloading|playing|found|appearing|importing)|isn'?t (?:working|loading|showing|downloading|playing|appearing|importing)|won'?t (?:play|load|download|import)|can'?t (?:see|find|play|watch|hear|access)|cannot|missing|stuck|broken|problem|issue|error|fail(?:ed|ing|s)?|wrong|fix|what'?s wrong|not available)\b/;
  if (trouble.test(text)) return { kind: 'diagnose', subject: subjectOf(text) };

  if (/\b(downloads?|downloading|queue|torrents?|progress|eta)\b/.test(text)) return { kind: 'downloads' };
  if (/\brequests?\b|\brequested\b/.test(text)) return { kind: 'requests' };
  if (/\b(how many|count|library|what do i have|what have i got|total|status|overview|summary)\b/.test(text)) return { kind: 'library' };
  return null;
}

export const HELP_TEXT = [
  'I can help with your library. Try:',
  '- "What is downloading?" or "Show failed downloads"',
  '- "Why is Linkin Park not showing tracks?" (I check services, downloads and imports)',
  '- "Retry Mr Robot" to search again for missing episodes, movies or albums',
  '- "Request Dune" or "Request the series Severance" or "Request the artist Adele"',
  '- "Pause / resume / remove <download name>"',
  '- "Which subtitles are missing?" or "Get subtitles for Troy"',
  '- "How many movies do I have?" or "My requests"',
  '- "List themes" or "Switch to Midnight"',
  'I only answer questions about this server and your media.'
].join('\n');

export const OFF_TOPIC_TEXT = 'I can only help with your virtuallyView library and services: downloads, requests, missing items, subtitles, themes and troubleshooting. Ask me something like "What is downloading?" or type "help".';

/** Best fuzzy match of `subject` against candidate names (all words must appear). */
export function bestMatch<T>(subject: string, items: T[], nameOf: (item: T) => string): T | undefined {
  const words = norm(subject).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(' ').filter(w => w.length > 1);
  if (!words.length) return undefined;
  const scored = items
    .map(item => {
      const name = norm(nameOf(item)).replace(/[^\p{L}\p{N}\s]/gu, ' ');
      const hits = words.filter(w => name.includes(w)).length;
      return { item, hits, len: name.length };
    })
    .filter(s => s.hits === words.length)
    .sort((a, b) => a.len - b.len);
  return scored[0]?.item;
}
