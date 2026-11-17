import * as React from 'react';
import type { ModelChoice } from './swap-sheet';

/** Stands in for the device's TONE3000 downloads: each takes about half a second. */
export function useModelDownloads(initial: ModelChoice[]) {
  const [models, setModels] = React.useState(initial);
  const [downloads, setDownloads] = React.useState<Record<string, number>>({});
  const timers = React.useRef<ReturnType<typeof setInterval>[]>([]);
  React.useEffect(() => {
    const running = timers.current;
    return () => running.forEach(clearInterval);
  }, []);
  const onGet = (choice: ModelChoice) => {
    let progress = 0;
    setDownloads((d) => ({ ...d, [choice.id]: progress }));
    const timer = setInterval(() => {
      progress += 25;
      if (progress <= 100) {
        setDownloads((d) => ({ ...d, [choice.id]: progress }));
        return;
      }
      clearInterval(timer);
      setDownloads((d) => {
        const next = { ...d };
        delete next[choice.id];
        return next;
      });
      setModels((all) =>
        all.map((m) => (m.id === choice.id ? { ...m, downloaded: true } : m)),
      );
    }, 120);
    timers.current.push(timer);
  };
  return { models, downloads, onGet };
}
