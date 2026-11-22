import { useState } from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '../components/ui/dialog';
import { blocksOf } from '../lib/route';
import { useRemembered } from '../lib/use-remembered';
import { EFFECTS } from '../patterns/block-chooser.data';
import { NamBlockToolsDemo } from '../patterns/nam-block.demo';
import { PARALLEL_ROUTE, SCENES, SERIAL_ROUTE } from '../patterns/rig.fixtures';
import { RigAudioUnavailable } from '../patterns/rig-audio-unavailable';
import { RigSurface } from '../patterns/rig-surface';
import { useModelDownloads } from '../patterns/swap.demo';
import { BLOCK_TYPES, MODELS } from '../patterns/swap.fixtures';
import { useRigDemo } from '../patterns/use-rig.demo';
import { ParallelListeningDemo } from '../widgets/parallel-listening.demo';
import { PresetNameButton, PresetSteps } from '../widgets/preset-steps';
import {
  type StompAssignment,
  StompAssignmentDialog,
} from '../widgets/stomp-group';
import {
  CAPTURE_ROUTE,
  CAPTURE_SCENES,
  CAPTURE_STOMP_KEY,
  CAPTURE_WET,
} from './four-captures.fixtures';

const PRESETS = ['Rhythm section', 'Echo lead', 'Parallel amps'] as const;

/** The Rig screen: the rig surface, or the card that says why audio is not playing. */
export function Rig({ audio = true }: { audio?: boolean }) {
  const [position, setPosition] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const presetName = PRESETS[position]!;
  const [stomp, saveStomp] = useRemembered<StompAssignment | null>(
    CAPTURE_STOMP_KEY,
    CAPTURE_WET,
  );
  const [assigning, setAssigning] = useState(false);
  const rhythm = useRigDemo(CAPTURE_ROUTE, CAPTURE_SCENES);
  const echo = useRigDemo(SERIAL_ROUTE);
  const parallel = useRigDemo(PARALLEL_ROUTE);
  const rig = [rhythm, echo, parallel][position]!;
  const store = useModelDownloads(MODELS);
  if (!audio) return <RigAudioUnavailable />;
  return (
    <RigSurface
      blockTools={(b) => b.kind === 'amp' && <NamBlockToolsDemo />}
      models={store.models}
      blockTypes={BLOCK_TYPES}
      effects={EFFECTS}
      downloads={store.downloads}
      onGetModel={store.onGet}
      catalogue={store.catalogue}
      key={position}
      presetName={presetName}
      presetTitle={
        <PresetNameButton
          name={presetName}
          className="inline-flex min-h-touch items-center gap-2"
          onOpen={() => {
            setQuery('');
            setSearching(true);
          }}
        />
      }
      presetSteps={
        <>
          <Dialog open={searching} onOpenChange={setSearching}>
            <DialogContent>
              <DialogHeader title="Choose a preset" closeLabel="Close" />
              <DialogBody className="grid gap-2">
                <input
                  type="search"
                  aria-label="Find a preset"
                  placeholder="Find a preset…"
                  className="min-h-touch rounded-md border px-3"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {PRESETS.map(
                  (name, i) =>
                    name.toLowerCase().includes(query.toLowerCase().trim()) && (
                      <Button
                        key={name}
                        variant="outline"
                        aria-pressed={i === position}
                        onClick={() => {
                          setSearching(false);
                          setPosition(i);
                        }}
                      >
                        {name}
                      </Button>
                    ),
                )}
                {!PRESETS.some((name) =>
                  name.toLowerCase().includes(query.toLowerCase().trim()),
                ) && <p>No matching presets.</p>}
              </DialogBody>
            </DialogContent>
          </Dialog>
          <PresetSteps
            previous={PRESETS[position - 1]}
            next={PRESETS[position + 1]}
            onStep={(dir) =>
              setPosition((n) =>
                Math.max(0, Math.min(PRESETS.length - 1, n + dir)),
              )
            }
          />
        </>
      }
      stompControls={
        position === 2 ? (
          <ParallelListeningDemo />
        ) : (
          position === 0 && (
            <div className="px-page">
              <Button variant="outline" onClick={() => setAssigning(true)}>
                {stomp
                  ? 'Edit ' + stomp.name + ' switch'
                  : 'Assign a stomp switch'}
              </Button>
              {assigning && (
                <StompAssignmentDialog
                  initial={stomp ?? undefined}
                  blocks={blocksOf(rig.route).map((b) => ({
                    id: b.id,
                    name: b.label,
                  }))}
                  disabled={false}
                  onClose={() => setAssigning(false)}
                  onRemove={
                    stomp
                      ? () => {
                          saveStomp(null);
                          setAssigning(false);
                        }
                      : undefined
                  }
                  onSave={(name, nodes) => {
                    saveStomp({ id: 'wet', name, nodes });
                    setAssigning(false);
                  }}
                />
              )}
            </div>
          )
        )
      }
      playing
      route={rig.route}
      saved={rig.saved}
      onRoute={rig.onRoute}
      versions={rig.versions}
      currentVersion={rig.current}
      onVersion={rig.onVersion}
      onSaveVersion={rig.onSaveVersion}
      onSaveVersionAs={rig.onSaveVersionAs}
      onMakeDefault={rig.onMakeDefault}
      scenes={rig.settings ?? (position === 0 ? CAPTURE_SCENES : SCENES)}
      sceneSettings={rig.settings}
      savedSceneSettings={rig.savedSettings}
      onSceneSettings={rig.setSettings}
      activeScene={rig.scene}
      onScene={rig.onScene}
      sceneChanged={rig.sceneChanged}
      levels={rig.levels}
      inputLevel={rig.input}
      onAudition={rig.onAudition}
      onAdd={rig.onAdd}
    />
  );
}
