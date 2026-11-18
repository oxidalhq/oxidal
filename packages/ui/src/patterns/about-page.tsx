import { type ReactNode, useId } from 'react';

import { Caption, Readout, Title } from '../components/ui/text';
import { type Credit, Credits } from './credits';
import { SettingRow } from './settings-page';

/**
 * The approved About composition. The application supplies device readback;
 * loading and unavailable values remain visible rather than becoming examples.
 * @see docs/interface.md
 */
export function AboutPage({
  device,
  credits,
  madeWith,
  author,
  children,
  footer,
}: {
  device: readonly { label: string; value: string }[];
  credits: Credit[];
  madeWith: Credit[];
  author?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const title = useId();
  return (
    <section aria-labelledby={title} className="grid gap-6">
      <h2 id={title} className="sr-only">
        About Oxidal
      </h2>
      <div className="grid justify-items-center gap-3 rounded-lg bg-enclosure px-6 py-8 text-center text-enclosure-foreground">
        <img
          src="/brand/wordmark-white.svg"
          alt="Oxidal"
          className="h-10 max-w-full"
        />
        <span className="small-caps text-sm font-medium text-enclosure-foreground/80">
          Multi-effects amp modeler · guitar and bass
        </span>
        <p className="m-0 max-w-md text-md text-enclosure-foreground/85">
          Turn a Raspberry Pi 5 and your audio interface into a complete guitar
          and bass rig, played from this browser.
        </p>
        {author && (
          <p className="m-0 text-sm text-enclosure-foreground/85">{author}</p>
        )}
        <Credits credits={credits} dark />
      </div>
      <div className="grid gap-2">
        <Title as="h3" size="sm">
          This device
        </Title>
        {device.map(({ label, value }) => (
          <SettingRow key={label} label={label}>
            <Readout size="sm" className="max-w-full break-words">
              {value}
            </Readout>
          </SettingRow>
        ))}
      </div>
      <div className="grid gap-2">
        <Title as="h3" size="sm">
          Made with
        </Title>
        <Credits credits={madeWith} className="justify-start" />
        <Caption>
          Open source under the Apache License 2.0; some optional native
          components use separately licensed dependencies. The Oxidal name and
          logo are not covered by the licence. Third-party licences are listed
          in THIRD_PARTY.md.
        </Caption>
      </div>
      {children}
      {footer}
    </section>
  );
}
