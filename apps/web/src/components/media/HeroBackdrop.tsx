import { useEffect, useRef, useState } from 'react';

/** Backdrop that fades in over a blurred copy of the poster, so the hero is never an empty black block. */
export function HeroBackdrop({ backdrop, poster }: { backdrop?: string; poster?: string }) {
  const [ready, setReady] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A cached image can finish before React attaches onLoad.
    setReady(!!img.current?.complete && img.current.naturalWidth > 0);
  }, [backdrop]);
  if (!backdrop && !poster) return <div className="detail-backdrop detail-backdrop--placeholder" />;
  return (
    <>
      {poster && <img className="detail-backdrop detail-backdrop--poster" src={poster} alt="" aria-hidden="true" />}
      {backdrop && <img ref={img} className={`detail-backdrop detail-backdrop--fade${ready ? ' is-ready' : ''}`} src={backdrop} alt="" onLoad={() => setReady(true)} />}
    </>
  );
}
