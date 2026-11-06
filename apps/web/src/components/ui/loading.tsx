import { useEffect, useState } from 'react';
import { CircleNotch } from '@phosphor-icons/react';

/**
 * One preloader for the whole interface (7.21). It waits ~300 ms before
 * appearing, so quick loads never flash, then says what is loading. It sits
 * at the boundary being loaded; the rest of the screen stays usable.
 * @see docs/interface.md
 */
export function Loading({
  label,
  delay = 300,
}: {
  /** What is loading, as in "Loading Library…". */
  label: string;
  delay?: number;
}) {
  const [shown, setShown] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const timer = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  return (
    <div
      className="oxidal-loading"
      role="status"
      aria-live="polite"
      data-shown={shown}
    >
      {shown && (
        <>
          <CircleNotch aria-hidden="true" className="oxidal-loading-icon" />
          <span>{label}</span>
        </>
      )}
    </div>
  );
}
