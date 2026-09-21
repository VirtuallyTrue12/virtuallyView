import { useEffect, useRef, useState } from 'react';

export default function LazyImage({ src, alt = '', className = '' }: { src: string; alt?: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          img.src = src;
          img.onload = () => setLoaded(true);
          observer.unobserve(img);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(img);
    return () => observer.disconnect();
  }, [src]);

  return (
    <img
      ref={ref}
      alt={alt}
      className={className}
      loading="lazy"
      style={{ opacity: loaded ? 1 : 0.3, transition: 'opacity 0.3s ease' }}
    />
  );
}
