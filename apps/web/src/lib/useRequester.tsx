import { useCallback, useState, type ReactNode } from 'react';
import type { MediaKind } from './api';
import { CandidatePicker } from '../components/requests/CandidatePicker';
import { ReleaseNotice } from '../components/requests/ReleaseNotice';
import { submitRequest, type RequestCandidate, type RequestOutcome } from './request-selection';

interface Base { title: string; year?: number; mediaType: MediaKind }
interface Pending { base: Base; candidates: RequestCandidate[]; message?: string }

/**
 * One request flow for every page: submit, and when the lookup is ambiguous
 * show the candidate picker instead of a dead-end error.
 */
export function useRequester(onDone: (outcome: RequestOutcome, base: Base) => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [early, setEarly] = useState<{ base: Base & { selectedProviderId?: string }; message: string } | null>(null);

  const submit = useCallback(async (base: Base & { selectedProviderId?: string }) => {
    setBusy(true);
    const outcome = await submitRequest(base);
    setBusy(false);
    if (outcome.kind === 'ambiguous') setPending({ base, candidates: outcome.candidates, message: outcome.message });
    else if (outcome.kind === 'unreleased') setEarly({ base: { ...base, selectedProviderId: outcome.candidate.providerId }, message: outcome.message });
    else onDone(outcome, base);
    return outcome;
  }, [onDone]);

  const chooseRelease = async (choice: 'wait' | 'now') => {
    if (!early) return;
    setBusy(true);
    const outcome = await submitRequest({ ...early.base, releaseChoice: choice });
    setBusy(false);
    setEarly(null);
    onDone(outcome, early.base);
  };

  const openPicker = useCallback((base: Base, candidates: RequestCandidate[], message?: string) => {
    setPending({ base, candidates, ...(message ? { message } : {}) });
  }, []);

  const pick = async (candidate: RequestCandidate) => {
    if (!pending) return;
    setBusy(true);
    const base = { title: candidate.title, year: candidate.year, mediaType: candidate.type, selectedProviderId: candidate.providerId };
    const outcome = await submitRequest(base);
    setBusy(false);
    if (outcome.kind === 'ambiguous') {
      setPending({ base, candidates: outcome.candidates, message: outcome.message });
      return;
    }
    setPending(null);
    if (outcome.kind === 'unreleased') {
      setEarly({ base, message: outcome.message });
      return;
    }
    onDone(outcome, base);
  };

  const picker: ReactNode = early ? (
    <ReleaseNotice title={early.base.title} message={early.message} busy={busy} onChoose={c => void chooseRelease(c)} onClose={() => setEarly(null)} />
  ) : pending ? (
    <CandidatePicker
      title={pending.base.title}
      {...(pending.message ? { message: pending.message } : {})}
      candidates={pending.candidates}
      busy={busy}
      onPick={c => void pick(c)}
      onClose={() => setPending(null)}
    />
  ) : null;

  return { submit, openPicker, picker, busy };
}
