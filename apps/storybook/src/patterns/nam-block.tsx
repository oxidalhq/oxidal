import * as React from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Caption } from '../components/ui/text';
import { SettingGroup, SettingRow } from './settings-page';

/**
 * The NAM block's own tools, in its full editor: the capture size (staged,
 * then applied, because the block reloads), your own copy of a TONE3000
 * tone before changing it, reload from the file, and separating a capture
 * that has its cab built in into an amp block and a cab block.
 */
export function NamBlockTools({
  fromTone3000 = true,
}: {
  fromTone3000?: boolean;
}) {
  const [size, setSize] = React.useState('standard');
  const [staged, setStaged] = React.useState('standard');
  const [mine, setMine] = React.useState(!fromTone3000);
  const [separating, setSeparating] = React.useState(false);
  const [headOnly, setHeadOnly] = React.useState(false);
  const [separated, setSeparated] = React.useState(false);
  return (
    <>
      <SettingGroup title="Capture">
        <SettingRow
          label="Size"
          caption={
            staged !== size
              ? `Lite uses less processing. Apply reloads this block for a moment.`
              : 'Smaller sizes leave room for more amps.'
          }
          stacked
        >
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              value={staged}
              onValueChange={setStaged}
              aria-label="Capture size"
            >
              <Segment value="standard">Standard</Segment>
              <Segment value="lite">Lite</Segment>
              <Segment value="feather">Feather</Segment>
              <Segment value="nano">Nano</Segment>
            </SegmentedControl>
            {staged !== size && (
              <>
                <Button size="sm" onClick={() => setSize(staged)}>
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStaged(size)}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </SettingRow>
        <SettingRow
          label={mine ? 'Your copy' : 'From TONE3000'}
          caption={
            mine
              ? 'Plexi 50 (mine) · your settings are saved with it.'
              : 'Plexi 50 by Jane Capture · CC BY 4.0. Save your own copy to keep changes to it.'
          }
        >
          {mine ? (
            <Badge size="sm">Mine</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setMine(true)}>
              Save a copy
            </Button>
          )}
        </SettingRow>
        <SettingRow
          label="Reload from the file"
          caption="Undo every change since the capture was loaded."
        >
          <Button size="sm" variant="ghost">
            Reload
          </Button>
        </SettingRow>
        <SettingRow
          label="Amp and cab"
          caption={
            separated
              ? 'Separated: this block is the amp; the cab block after it can be changed.'
              : 'This capture has its cab built in.'
          }
        >
          {!separated && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSeparating(true)}
            >
              Separate amp and cab…
            </Button>
          )}
        </SettingRow>
      </SettingGroup>
      <Dialog open={separating} onOpenChange={setSeparating}>
        <DialogContent>
          <DialogHeader
            title="Separate amp and cab"
            description="Makes an amp block and a cab block from this capture, so you can try other cabs."
          />
          <DialogBody className="grid gap-2">
            <Caption>
              Oxidal works from the saved capture, not from what you are hearing
              now. A new preset is made; this one stays as it is.
            </Caption>
            <label className="flex min-h-touch items-center gap-2 text-sm">
              <Checkbox
                checked={headOnly}
                onCheckedChange={(v) => setHeadOnly(v === true)}
              />
              This NAM is an amp-head capture, without a cab built in
            </label>
            {headOnly && (
              <Caption role="status">
                Then there is no cab to separate. Add a cab block after it
                instead.
              </Caption>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeparating(false)}>
              Cancel
            </Button>
            <Button
              disabled={headOnly}
              onClick={() => {
                setSeparated(true);
                setSeparating(false);
              }}
            >
              Separate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
