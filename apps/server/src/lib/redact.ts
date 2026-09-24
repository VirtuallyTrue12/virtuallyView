// Addresses that carry a secret in the query string (signed playback links,
// live relay links, tokens) must never reach the logs in full.
const SECRET_PARAM = /([?&](?:st|s|e|u|token|key|apikey|api_key|password|pass|secret|sig|signature)=)[^&#]*/gi;

export function redactUrl(url: string | undefined): string {
  return (url ?? '').replace(SECRET_PARAM, '$1[redacted]');
}
