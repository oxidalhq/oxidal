import { useState } from 'react';

import { TempoSource } from '@oxidal/design-system/patterns/tempo-source';

import { sendTempo } from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { refreshMonitorFeed, useMonitorFeed } from '../../monitorFeed';

export function PerformanceTempo() {
  const { snapshot, disconnected } = useMonitorFeed(1000);
  const tempo = snapshot?.tempo;
  const [error, setError] = useState('');
  async function select(source: 'tap' | 'song' | 'preset') {
    if (!tempo) return;
    setError('');
    try {
      await sendTempo(
        source === 'tap'
          ? { kind: 'tap' }
          : { kind: 'select', source, expected_revision: tempo.revision },
      );
    } catch (cause) {
      setError(friendlyError(cause, 'change the performance tempo'));
    } finally {
      refreshMonitorFeed();
    }
  }
  return (
    <>
      <TempoSource
        state={tempo ?? undefined}
        disabled={disconnected}
        onSelect={(source) => void select(source)}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
