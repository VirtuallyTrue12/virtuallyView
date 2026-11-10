import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type VideoChannel } from '../../lib/api';
import { toast } from '../ui/Toast';

/** The channels this person follows, and one toggle used by every Subscribe button. */
export function useSubscriptions() {
  const [channels, setChannels] = useState<VideoChannel[] | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.videoSubscriptions().then(r => setChannels(r.channels)).catch(() => setChannels([])); }, []);
  const ids = useMemo(() => new Set((channels ?? []).map(c => c.id)), [channels]);

  const toggle = useCallback(async (id: string, name: string): Promise<boolean> => {
    setBusy(id);
    try {
      if (ids.has(id)) {
        await api.videoUnsubscribe(id);
        setChannels(list => (list ?? []).filter(c => c.id !== id));
        toast(`Unsubscribed from ${name}`);
      } else {
        const { channel } = await api.videoSubscribe(id);
        setChannels(list => [channel, ...(list ?? []).filter(c => c.id !== id)]);
        toast(`Subscribed to ${name}`, { tone: 'ok' });
      }
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not change that. Try again.', { tone: 'err' });
      return false;
    } finally { setBusy(null); }
  }, [ids]);

  return { channels, ids, toggle, busy };
}
