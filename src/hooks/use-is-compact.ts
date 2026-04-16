import { useState, useEffect } from 'react';

const COMPACT_BREAKPOINT = 640;

export function useIsCompact() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${COMPACT_BREAKPOINT - 1}px)`);
    const onChange = () => setIsCompact(mql.matches);
    mql.addEventListener('change', onChange);
    setIsCompact(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isCompact;
}
