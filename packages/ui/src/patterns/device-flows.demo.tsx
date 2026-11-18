import * as React from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import {
  BlockEq,
  type BootMode,
  BootPlayback,
  DebugConsole,
  DiReamps,
  type EqPosition,
  StorageLock,
  type StorageMode,
} from './device-flows';

const BANDS = [
  { id: 1, name: 'Low', hz: 120 },
  { id: 2, name: 'Low mid', hz: 400 },
  { id: 3, name: 'High mid', hz: 2000 },
  { id: 4, name: 'High', hz: 6000 },
];

export function BlockEqDemo() {
  const [saved, setSaved] = React.useState([0, -2, 1.5, 0]);
  const [gains, setGains] = React.useState(saved);
  const [position, setPosition] = React.useState<EqPosition>('after');
  const [status, setStatus] = React.useState('');
  return (
    <BlockEq
      block="Plexi 50"
      bands={BANDS}
      gains={gains}
      saved={saved}
      position={position}
      status={status}
      onGains={setGains}
      onPosition={setPosition}
      onKeep={() => {
        setSaved(gains);
        setStatus('Kept. Save the preset to keep it for good.');
      }}
      onCancel={() => {
        setGains(saved);
        setStatus('Cancelled. Nothing was saved.');
      }}
    />
  );
}

export function DiReampsDemo() {
  const [recording, setRecording] = React.useState(false);
  const [takes, setTakes] = React.useState([
    { id: 't1', name: 'Verse riff', length: '0:42', reamps: 2 },
    { id: 't2', name: 'Solo idea', length: '1:15', reamps: 0 },
  ]);
  return (
    <DiReamps
      takes={takes}
      recording={recording}
      preset="Rhythm section"
      onRecording={(on) => {
        setRecording(on);
        if (!on)
          setTakes((t) => [
            {
              id: `t${t.length + 1}`,
              name: `Take ${t.length + 1}`,
              length: '0:18',
              reamps: 0,
            },
            ...t,
          ]);
      }}
      onReamp={(id) =>
        setTakes((t) =>
          t.map((x) => (x.id === id ? { ...x, reamps: x.reamps + 1 } : x)),
        )
      }
    />
  );
}

export function StorageLockDemo() {
  const [current, setCurrent] = React.useState<StorageMode>('locked');
  const [next, setNext] = React.useState<StorageMode>('locked');
  const [review, setReview] = React.useState(false);
  return (
    <>
      <StorageLock
        current={current}
        nextBoot={next}
        onChange={setNext}
        restart={
          next !== current && (
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={() => setReview(true)}
            >
              Restart into {next === 'locked' ? 'Locked' : 'Unlocked'} mode…
            </Button>
          )
        }
      />
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent size="sm">
          <DialogHeader
            title={`Restart into ${next === 'locked' ? 'Locked' : 'Unlocked'} mode?`}
          />
          <DialogBody>
            Audio will stop. Save your edits before restarting.
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setCurrent(next);
                setReview(false);
              }}
            >
              Confirm restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BootPlaybackDemo() {
  const [mode, setMode] = React.useState<BootMode>('last');
  return (
    <BootPlayback
      mode={mode}
      lastSession="Rhythm section, Scene 2"
      onMode={setMode}
    />
  );
}

export function DebugConsoleDemo() {
  const [on, setOn] = React.useState(false);
  return (
    <DebugConsole
      on={on}
      minutesLeft={14}
      onChange={setOn}
      output={`oxidal-debug@oxidal:~$ systemctl status oxidald --no-pager\n● oxidald.service - Oxidal daemon\n   Active: active (running) since Mon 09:12\noxidal-debug@oxidal:~$ █`}
    />
  );
}
