import { useEffect, useRef, useState } from 'react';
import { SvgIcon } from '../ui/SvgIcon';
import { toast } from '../ui/Toast';
import './VoiceSearch.css';

// The slice of the Web Speech API we use. Not every TypeScript lib has these types.
interface SpeechResultLike { isFinal: boolean; 0?: { transcript: string } }
interface SpeechEventLike { resultIndex: number; results: ArrayLike<SpeechResultLike> }
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

/** The browser's speech recognizer, or null when this browser has none (Firefox, some older TVs). */
export function getSpeechRecognition(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Plain-language message for each speech error. Returns null when there is nothing to say. */
function voiceErrorText(code: string): string | null {
  switch (code) {
    case 'aborted': return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.';
    case 'no-speech': return 'I did not hear anything. Tap the mic and try again.';
    case 'audio-capture': return 'No microphone was found. Check that one is connected.';
    case 'network': return 'Voice search needs an internet connection in this browser.';
    default: return 'Voice search stopped. Try again, or type your search.';
  }
}

/** Microphone button for the search box. Renders nothing when speech recognition is not supported. */
export function VoiceSearchButton({ onResult }: { onResult: (text: string) => void }) {
  const [Ctor] = useState<RecognitionCtor | null>(() => getSpeechRecognition());
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const recRef = useRef<RecognitionLike | null>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  // Leaving the page stops listening, so the mic light does not stay on.
  useEffect(() => () => { recRef.current?.abort(); }, []);

  if (!Ctor) return null;

  const start = () => {
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finals = '';
    let latest = '';
    let failed = false;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finals = `${finals} ${text}`.trim();
        else interim = `${interim} ${text}`.trim();
      }
      latest = `${finals} ${interim}`.trim();
      setHeard(latest);
    };
    rec.onerror = (e) => {
      failed = true;
      const message = voiceErrorText(e.error);
      if (message) toast(message, { tone: 'err' });
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setHeard('');
      // Whatever was heard goes into the box and runs as a search. Errors leave the box alone.
      if (!failed && latest) onResultRef.current(latest);
    };

    recRef.current = rec;
    setHeard('');
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
      toast('Voice search is busy. Try again in a moment.', { tone: 'err' });
    }
  };

  const toggle = () => {
    if (listening) recRef.current?.stop();
    else start();
  };

  return (
    <>
      <button
        type="button"
        className={`voice-mic${listening ? ' is-listening' : ''}`}
        onClick={toggle}
        aria-label={listening ? 'Stop voice search' : 'Search by voice'}
        aria-pressed={listening}
        title={listening ? 'Stop listening' : 'Search by voice'}
      >
        <SvgIcon name="mic" size={18} />
      </button>
      {listening && (
        <p className="voice-live" role="status" aria-live="polite">
          {heard ? <>Heard: <span className="voice-live-text">{heard}</span></> : 'Listening... say what you want to find.'}
        </p>
      )}
    </>
  );
}
