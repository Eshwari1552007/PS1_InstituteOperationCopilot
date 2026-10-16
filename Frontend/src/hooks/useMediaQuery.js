import { useEffect, useState } from 'react';

function canMatchMedia() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (canMatchMedia() ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!canMatchMedia()) return undefined;

    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);

    setMatches(list.matches);
    if (list.addEventListener) {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, [query]);

  return matches;
}
