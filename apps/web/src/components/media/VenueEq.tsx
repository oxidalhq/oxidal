import { CheckCircle, Lock, Warning } from '@phosphor-icons/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import './media.css';
import './venue.css';
import {
  keepVenuePreview,
  type VenueCommand,
  venueCommand,
  VenueConflict,
  type VenueSettings,
  type VenueState,
  venueState,
} from '../../api';
import { DeviceError, deviceSentence } from '../../lib/friendlyError';
import { setLeaveGuard } from '../../lib/leaveGuard';
import { formatDb, headroom, withBand } from '../../lib/venueEq';
import { onVenue } from '../../lib/venueFeed';
import { PreviewThrottle } from '../../lib/venuePreview';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { BandEditor } from './BandEditor';
import { EqGraph, type GraphChange } from './EqGraph';
import { MoreMenu } from './MediaRow';
import { useProtect } from './sessionMedia';
import {
  DeleteProfileDialog,
  LeaveDialog,
  ProfileDialog,
} from './VenueDialogs';

/** An untouched preview is discarded after five minutes; keep it alive. */
const KEEP_MS = 60_000;
const VENUE_LOCKED =
  'Protect is on. Venue EQ is locked: no edits, bypass or profile changes.';
const CONFLICT =
  'Someone else changed the venue EQ. You are seeing their change now.';

const epaper = () => document.documentElement.dataset.display === 'epaper';
function watchDisplay(change: () => void) {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-display'],
  });
  return () => observer.disconnect();
}

type Dialog =
  | { kind: 'save-as' }
  | { kind: 'rename' }
  | { kind: 'delete' }
  | { kind: 'leave'; go: () => void; action: string; revert: boolean }
  | null;

/**
 * Settings › Audio › Output › Venue EQ: the device's output correction for the room.
 * Every change is a revision-checked venue command; edits are an owned
 * preview the outputs play at once and that only Save keeps. The device state
 * (event stream and replies) is the only source of truth; the screen holds a
 * local copy of a band only while a drag or step is on its way.
 * @see docs/media.md
 */
export function VenueEq({ connected }: { connected: boolean }) {
  const slow = useSyncExternalStore(watchDisplay, epaper, () => false);
  const protect = useProtect();
  const [venue, setVenue] = useState<VenueState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraftState] = useState<VenueSettings | null>(null);
  const [selected, setSelected] = useState(2);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState('');
  const [refusedLocked, setRefusedLocked] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [seenProtect, setSeenProtect] = useState(protect);
  if (seenProtect !== protect) {
    // A fresh Protect reading replaces the one a refusal implied.
    setSeenProtect(protect);
    setRefusedLocked(false);
  }
  const current = useRef<VenueState | null>(null);
  const draftRef = useRef<VenueSettings | null>(null);
  const setDraft = useCallback((next: VenueSettings | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  /** Take a state unless a newer one already arrived (`force` for a 409). */
  const accept = useCallback((next: VenueState, force = false) => {
    const previous = current.current;
    if (!force && previous && next.revision < previous.revision) return;
    current.current = next;
    setVenue(next);
  }, []);

  useEffect(() => {
    let alive = true;
    const off = onVenue((next) => accept(next));
    void venueState()
      .then((next) => alive && accept(next))
      .catch((cause: unknown) => {
        if (alive) setLoadError(deviceSentence(cause, 'read the venue EQ'));
      });
    return () => {
      alive = false;
      off();
    };
  }, [accept]);

  const refuse = useCallback(
    (cause: unknown) => {
      if (cause instanceof VenueConflict) {
        accept(cause.state, true);
        setConflict(CONFLICT);
        setMessage('');
      } else if (cause instanceof DeviceError && cause.status === 423) {
        setRefusedLocked(true);
        setMessage(VENUE_LOCKED);
      } else setMessage(deviceSentence(cause, 'change the venue EQ'));
    },
    [accept],
  );

  /** One venue command against the newest revision this screen has. */
  const send = useCallback(
    async (command: VenueCommand) => {
      const state = current.current;
      if (!state) throw new Error('The venue EQ is not loaded yet');
      const next = await venueCommand({
        expectedRevision: state.revision,
        command,
      });
      accept(next);
      return next;
    },
    [accept],
  );

  // One throttle per screen: drags send at most 20 previews a second.
  const throttle = useRef<PreviewThrottle<VenueSettings> | null>(null);
  useEffect(() => {
    const created = new PreviewThrottle<VenueSettings>(
      async (eq) => {
        try {
          await send({ kind: 'preview', eq });
          setConflict('');
          setMessage('');
        } catch (cause) {
          refuse(cause);
          throw cause;
        }
      },
      () => setDraft(null),
    );
    throttle.current = created;
    return () => {
      created.cancel();
      throttle.current = null;
    };
  }, [send, refuse, setDraft]);

  const active = venue?.profiles.find((profile) => profile.id === venue.active);
  const preview =
    venue?.preview && venue.preview.base === venue.active
      ? venue.preview
      : null;
  const edited = !!preview || draft !== null;
  const work = draft ?? preview?.eq ?? active?.eq ?? null;
  const compare = !!preview?.compareSaved && draft === null;
  const locked = protect || refusedLocked;
  const disabled = locked || !connected || busy || !venue;

  /** A finished, non-preview command: waits for any edit still on its way. */
  async function run(command: VenueCommand): Promise<boolean> {
    setBusy(true);
    setMessage('');
    try {
      await throttle.current?.whenIdle();
      await send(command);
      setConflict('');
      return true;
    } catch (cause) {
      refuse(cause);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** An edit: shown at once, sent throttled while dragging, at once when done. */
  function edit(next: VenueSettings, done: boolean) {
    if (locked || !connected || !venue) return;
    setDraft(next);
    if (done) throttle.current?.finish(next);
    else throttle.current?.push(next);
  }
  const editBand: GraphChange = (index, change, done) => {
    const base = draftRef.current ?? preview?.eq ?? active?.eq;
    if (base) edit(withBand(base, index, change), done);
  };

  // Keep an unsaved edit alive while this screen is open.
  const previewing = !!preview;
  useEffect(() => {
    if (!previewing || !connected) return;
    const timer = window.setInterval(
      () => void keepVenuePreview().catch(() => undefined),
      KEEP_MS,
    );
    return () => window.clearInterval(timer);
  }, [previewing, connected]);

  // Leaving with an unsaved edit asks first (not while Protect locks it).
  useEffect(() => {
    if (!edited || locked) return;
    return setLeaveGuard((go) => {
      setDialog({
        kind: 'leave',
        go,
        action: 'Revert and leave',
        revert: true,
      });
      return true;
    });
  }, [edited, locked]);

  if (loadError && !venue)
    return (
      <section
        className="panel control-stack venue"
        aria-labelledby="venue-title"
      >
        <h2 id="venue-title">Venue EQ</h2>
        <p role="alert">{loadError}</p>
      </section>
    );
  if (!venue || !active || !work)
    return (
      <section
        className="panel control-stack venue"
        aria-labelledby="venue-title"
      >
        <h2 id="venue-title">Venue EQ</h2>
        <p role="status">Reading the venue EQ…</p>
      </section>
    );

  const openDialog = (next: Dialog) => {
    setMessage('');
    setDialog(next);
  };
  const users = venue.profiles.filter((profile) => !profile.builtin);
  const builtins = venue.profiles.filter((profile) => profile.builtin);
  const check = headroom(work);
  const notice = venue.notice && venue.notice !== dismissed ? venue.notice : '';
  function choose(profile: string) {
    if (profile === venue?.active) return;
    const go = () => void run({ kind: 'activate', profile });
    // Switching drops the edit on the device, so it needs no Revert first.
    if (edited)
      openDialog({
        kind: 'leave',
        go,
        action: 'Revert and switch',
        revert: false,
      });
    else go();
  }
  async function duplicate() {
    const before = new Set(venue?.profiles.map((profile) => profile.id));
    const wasEdited = edited;
    if (!(await run({ kind: 'duplicate', profile: active!.id }))) return;
    // The copy becomes the profile in use, unless that would drop an edit.
    const copy = current.current?.profiles.find((p) => !before.has(p.id));
    if (copy && !wasEdited) await run({ kind: 'activate', profile: copy.id });
  }

  return (
    <section
      className="panel control-stack venue"
      aria-labelledby="venue-title"
      data-locked={locked || undefined}
    >
      <div>
        <h2 id="venue-title" tabIndex={-1}>
          Venue EQ
        </h2>
        <p className="caption">
          Applies to: Main outputs (and headphones on this interface).
        </p>
      </div>
      {notice && (
        <div className="venue-note" role="status">
          <p>
            {notice.replace(/\.?$/, '.')}
            {!edited && ` You're hearing the saved "${active.name}".`}
          </p>
          <Button
            variant="outline"
            onClick={() => setDismissed(venue.notice ?? null)}
          >
            Dismiss
          </Button>
        </div>
      )}
      {locked && (
        <div className="venue-note" role="status" data-kind="locked">
          <Lock aria-hidden="true" weight="bold" />
          <p>{VENUE_LOCKED}</p>
        </div>
      )}
      {conflict && (
        <div className="venue-note" role="alert" data-kind="conflict">
          <Warning aria-hidden="true" weight="bold" />
          <p>{conflict}</p>
          <Button variant="outline" onClick={() => setConflict('')}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="venue-head">
        <label className="venue-profile">
          <span className="sr-only">Venue profile</span>
          <Select
            value={venue.active}
            onValueChange={choose}
            disabled={disabled}
          >
            <SelectTrigger aria-label="Venue profile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {users.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Your profiles</SelectLabel>
                  {users.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>Starting points</SelectLabel>
                {builtins.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        {edited && (
          <span className="media-chip" data-state="edited">
            Edited · unsaved
          </span>
        )}
        <div className="venue-actions">
          <Button
            variant={edited ? 'default' : 'outline'}
            disabled={disabled || !edited}
            onClick={() => void run({ kind: 'save' })}
          >
            Save
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => openDialog({ kind: 'save-as' })}
          >
            Save as…
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !edited}
            onClick={() => void run({ kind: 'revert' })}
          >
            Revert
          </Button>
          {!disabled && (
            <MoreMenu
              name={active.name}
              label="Profile actions"
              items={
                active.builtin
                  ? [{ label: 'Duplicate', onSelect: () => void duplicate() }]
                  : [
                      {
                        label: 'Rename…',
                        onSelect: () => openDialog({ kind: 'rename' }),
                      },
                      { label: 'Duplicate', onSelect: () => void duplicate() },
                      {
                        label: 'Delete…',
                        onSelect: () => openDialog({ kind: 'delete' }),
                      },
                    ]
              }
            />
          )}
        </div>
      </div>
      {active.builtin ? (
        <p className="caption">
          &ldquo;{active.name}&rdquo; is a starting point to tune by ear, not a
          measured correction. Saving makes your own copy.
        </p>
      ) : (
        active.notes && <p className="caption">{active.notes}</p>
      )}
      <EqGraph
        eq={work}
        saved={active.eq}
        edited={edited}
        bypass={venue.bypass}
        compare={compare}
        selected={selected}
        locked={disabled}
        slow={slow}
        label={active.name}
        onSelect={setSelected}
        onChange={editBand}
      />
      <BandEditor
        eq={work}
        selected={selected}
        locked={disabled}
        onSelect={setSelected}
        onChange={(index, change) => editBand(index, change, true)}
        onTrim={(trimDb) => edit({ ...work, trimDb }, true)}
      />
      <div className="venue-foot">
        <div className="venue-actions">
          <Button
            variant={venue.bypass ? 'default' : 'outline'}
            aria-pressed={venue.bypass}
            disabled={disabled}
            onClick={() =>
              void run({ kind: 'set_bypass', bypass: !venue.bypass })
            }
          >
            Bypass: {venue.bypass ? 'On' : 'Off'}
          </Button>
          <Button
            variant={compare ? 'default' : 'outline'}
            aria-pressed={compare}
            disabled={disabled || !preview}
            onClick={() => void run({ kind: 'compare_saved', saved: !compare })}
          >
            Compare to saved
          </Button>
        </div>
        {check.risky ? (
          <div className="venue-note" data-kind="headroom" role="status">
            <Warning aria-hidden="true" weight="bold" />
            <p>Adds up to {formatDb(check.peak)}; risk of clipping.</p>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => edit({ ...work, trimDb: check.trim! }, true)}
            >
              Set trim to {formatDb(check.trim!)}
            </Button>
          </div>
        ) : (
          <p className="venue-peak" role="status">
            Peak boost {formatDb(check.peak)}
            <CheckCircle aria-label="within +6 dB" weight="bold" />
          </p>
        )}
      </div>
      <p className="caption">
        Doesn't change presets, recordings or reamp results.
      </p>
      {message && !locked && !dialog && <p role="alert">{message}</p>}
      {busy && (
        <p className="sr-only" role="status">
          Sending…
        </p>
      )}
      {dialog?.kind === 'save-as' && (
        <ProfileDialog
          title="Save venue profile as"
          name={active.builtin ? `${active.name} copy` : `${active.name} 2`}
          notes={active.builtin ? '' : (active.notes ?? '')}
          error={message}
          onCancel={() => setDialog(null)}
          onSave={async (name, notes) => {
            if (await run({ kind: 'save_as', name, notes })) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <ProfileDialog
          title="Rename venue profile"
          name={active.name}
          notes={active.notes ?? ''}
          error={message}
          onCancel={() => setDialog(null)}
          onSave={async (name, notes) => {
            if (await run({ kind: 'rename', profile: active.id, name, notes }))
              setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteProfileDialog
          name={active.name}
          error={message}
          onCancel={() => setDialog(null)}
          onDelete={async () => {
            if (await run({ kind: 'delete', profile: active.id }))
              setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'leave' && (
        <LeaveDialog
          name={active.name}
          action={dialog.action}
          error={message}
          onKeep={() => setDialog(null)}
          onLeave={async () => {
            const { go, revert } = dialog;
            throttle.current?.cancel();
            setDraft(null);
            if (!revert || (await run({ kind: 'revert' }))) {
              setDialog(null);
              go();
            }
          }}
        />
      )}
    </section>
  );
}
