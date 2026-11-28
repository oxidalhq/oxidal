import {
  ArrowSquareOut,
  BookOpen,
  GithubLogo,
  User,
} from '@phosphor-icons/react';
import * as React from 'react';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from '../components/ui/dialog';
import { glyphForSource, type GlyphKey } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { safeLink } from '../lib/links';
import { BlockGlyph } from './block-glyph';

/**
 * Where a block comes from. Every block names its maker and how to reach
 * them: a TONE3000 tone and its creator, your own file, an LV2 plugin and
 * its pack, Oxidal's own code, or an effect inside the TONE3000 engine.
 */
export type BlockSource =
  | {
      kind: 'tone3000';
      title: string;
      creator: { name: string; username?: string; profile?: string };
      /** The tone's page on TONE3000. */
      page: string;
      /** The tone's picture, served by the device. */
      image?: string;
      /** More pictures of the tone, when it has several. */
      images?: string[];
      /** How many models the tone holds, by type. */
      counts?: { standard?: number; a2?: number; custom?: number };
      /** Such as "Amp", "Pedal", "Full rig". */
      gear?: string;
      /** Such as "NAM A2". */
      format?: string;
      models?: number;
      licence: string;
    }
  | {
      kind: 'file';
      title: string;
      type: 'NAM' | 'IR';
      /** From the file's own details, when it has them. */
      author?: string;
      trainer?: string;
      gear?: string;
      /** Where the file says it came from. */
      link?: string;
      /** For an IR: what the audio file is. */
      audio?: {
        sampleRate: number;
        bits: number;
        channels: number;
        durationMs: number;
      };
      /** The start of the file's SHA-256, to tell two copies apart. */
      fingerprint?: string;
    }
  | {
      kind: 'lv2';
      title: string;
      author?: string;
      /** Such as "Delay" or "Dynamics". */
      category?: string;
      /** The plugin's LV2 URI. */
      uri?: string;
      /** The plugin's own page, when its bundle names one. */
      homepage?: string;
      pack: {
        name: string;
        version?: string;
        /** The Debian package it installs from. */
        package?: string;
        website: string;
        licence?: string;
        /** The installed package's complete copyright and licence text. */
        copyright?: string;
        /** How Oxidal tested it, such as "Qualified on ARM64". */
        qualification?: string;
      };
    }
  | {
      kind: 'oxidal';
      title: string;
      /** The Rust crate, such as "oxidal-bloom". */
      crate: string;
      licence: string;
      /** The source code. */
      repo: string;
      /** The papers it is built from (its REFERENCES.md). */
      references?: string[];
      referencesUrl?: string;
    }
  | {
      kind: 'engine';
      title: string;
      /** The engine it is part of, such as "TONE3000 engine". */
      engine: string;
      page?: string;
    };

const PROVIDER: Record<BlockSource['kind'], string> = {
  tone3000: 'TONE3000',
  file: 'Your file',
  lv2: 'LV2 plugin',
  oxidal: 'Oxidal',
  engine: 'Built in',
};

function maker(source: BlockSource): string | undefined {
  switch (source.kind) {
    case 'tone3000':
      return source.creator.name;
    case 'file':
      return source.author;
    case 'lv2':
      return source.author ?? source.pack.name;
    case 'oxidal':
      return 'Oxidal';
    case 'engine':
      return source.engine;
  }
}

function home(source: BlockSource): string | undefined {
  switch (source.kind) {
    case 'tone3000':
      return safeLink(source.page);
    case 'file':
      return safeLink(source.link);
    case 'lv2':
      return safeLink(source.homepage) ?? safeLink(source.pack.website);
    case 'oxidal':
      return safeLink(source.repo);
    case 'engine':
      return safeLink(source.page);
  }
}

/** The provider's mark: TONE3000's wordmark, Oxidal's mark, or a plain label. */
export function ProviderMark({
  source,
  className,
}: {
  source: BlockSource;
  className?: string;
}) {
  if (source.kind === 'tone3000')
    return (
      <img
        src="/brand/credits/tone3000.svg"
        alt="TONE3000"
        className={cn('h-3 w-auto', className)}
      />
    );
  if (source.kind === 'oxidal')
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <img src="/brand/mark.svg" alt="" className="size-3.5" />
        Oxidal
      </span>
    );
  return (
    <span
      className={cn(
        'rounded border border-border px-1 small-caps text-2xs leading-4',
        className,
      )}
    >
      {source.kind === 'lv2'
        ? 'LV2'
        : source.kind === 'file'
          ? source.type
          : PROVIDER[source.kind]}
    </span>
  );
}

function Out({
  href,
  children,
  className,
}: {
  href: string | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  if (!href)
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        {children}
      </span>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
    >
      {children}
    </a>
  );
}

/**
 * Where a block comes from, in one line: the provider's mark and the maker,
 * linking out. For rows (Library, the block chooser) and the docked block
 * panel.
 */
export function SourceLine({
  source,
  plain = false,
  className,
}: {
  source: BlockSource;
  /** No links, for rows that are buttons themselves; About shows them. */
  plain?: boolean;
  className?: string;
}) {
  const who = maker(source);
  const link = plain ? undefined : home(source);
  return (
    <span
      data-slot="source-line"
      className={cn(
        'inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <ProviderMark source={source} />
      {who && source.kind !== 'oxidal' && (
        <>
          <span aria-hidden="true">·</span>
          {!plain &&
          source.kind === 'tone3000' &&
          safeLink(source.creator.profile) ? (
            <Out href={safeLink(source.creator.profile)}>{who}</Out>
          ) : (
            <span>{who}</span>
          )}
        </>
      )}
      {source.kind === 'lv2' &&
        source.author &&
        source.author !== source.pack.name && (
          <>
            <span aria-hidden="true">·</span>
            {/* The project it ships in, such as Guitarix, with its site. */}
            <span>
              in{' '}
              {plain ? (
                source.pack.name
              ) : (
                <Out href={safeLink(source.pack.website)}>
                  {source.pack.name}
                </Out>
              )}
            </span>
          </>
        )}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${source.title} on ${source.kind === 'tone3000' ? 'TONE3000' : source.kind === 'oxidal' ? 'its source code' : 'its website'}`}
          className="rounded inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowSquareOut aria-hidden="true" className="size-3.5" />
        </a>
      )}
    </span>
  );
}

/**
 * The picture of what a block is: a TONE3000 tone's own picture (the device
 * fetches it once and keeps it, so it shows offline), Oxidal's mark for our
 * own effects, or the block's glyph. A picture that fails falls back to the
 * glyph.
 */
export function SourcePicture({
  source,
  glyph,
  pictureUrl,
  className,
}: {
  source?: BlockSource;
  /** The glyph to fall back on; from the source when not given. */
  glyph?: GlyphKey;
  pictureUrl?: string;
  className?: string;
}) {
  const image =
    pictureUrl ?? (source?.kind === 'tone3000' ? source.image : undefined);
  const [broken, setBroken] = React.useState<string | null>(null);
  return (
    <span
      data-slot="source-picture"
      aria-hidden="true"
      className={cn(
        'grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-background',
        className,
      )}
    >
      {image && broken !== image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setBroken(image)}
          className="size-full object-cover"
        />
      ) : source?.kind === 'oxidal' ? (
        <img src="/brand/mark.svg" alt="" className="size-1/2" />
      ) : (
        <BlockGlyph
          glyph={glyph ?? (source ? glyphForSource(source) : 'plugin')}
          className="size-1/2 text-muted-foreground"
        />
      )}
    </span>
  );
}

/**
 * A TONE3000 tone's own pictures, shown large: what is in the cab or the rig
 * is usually clearest from the creator's photos. The small picture on the
 * card opens this; blocks from elsewhere show their plain picture.
 */
export function ExpandablePicture({
  source,
  className,
}: {
  source: BlockSource;
  className?: string;
}) {
  const pictures =
    source.kind === 'tone3000'
      ? source.images?.length
        ? source.images
        : source.image
          ? [source.image]
          : []
      : [];
  const [at, setAt] = React.useState(0);
  const [broken, setBroken] = React.useState<string[]>([]);
  if (source.kind !== 'tone3000' || pictures.length === 0)
    return <SourcePicture source={source} className={className} />;
  const shown = pictures[Math.min(at, pictures.length - 1)]!;
  return (
    <Dialog onOpenChange={(open) => open && setAt(0)}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Show pictures of ${source.title}${pictures.length > 1 ? `, ${pictures.length} pictures` : ''}`}
          className="relative shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          <SourcePicture source={source} className={className} />
          {pictures.length > 1 && (
            <span
              aria-hidden="true"
              className="absolute right-1 bottom-1 rounded-full bg-foreground/70 px-1.5 text-2xs text-background"
            >
              {pictures.length}
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent size="lg" aria-describedby={undefined}>
        <DialogHeader
          title={source.title}
          description={`Pictures by ${source.creator.name}, from TONE3000`}
        />
        <DialogBody className="place-items-center">
          {broken.includes(shown) ? (
            <p className="m-0 text-sm text-muted-foreground">
              This picture could not be loaded. The device needs to reach
              TONE3000 the first time it shows a picture.
            </p>
          ) : (
            <img
              src={shown}
              alt={`${source.title}, picture ${at + 1} of ${pictures.length}`}
              onError={() => setBroken((b) => [...b, shown])}
              className="max-h-[65dvh] w-auto max-w-full rounded-md border border-border object-contain"
            />
          )}
          {pictures.length > 1 && (
            <ul
              aria-label="Pictures"
              className="m-0 flex list-none flex-wrap justify-center gap-2 p-0"
            >
              {pictures.map((src, i) => (
                <li key={src}>
                  <button
                    type="button"
                    aria-label={`Picture ${i + 1}`}
                    aria-pressed={i === at}
                    onClick={() => setAt(i)}
                    className={cn(
                      'block overflow-hidden rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring',
                      i === at && 'ring-2 ring-foreground',
                    )}
                  >
                    <img
                      src={src}
                      alt=""
                      loading="lazy"
                      className="size-14 object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-1 text-sm">
      <dt className="small-caps text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** A small round stand-in for the creator's avatar: their first letter. */
function CreatorBadge({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground uppercase"
    >
      {name.trim().charAt(0) || <User className="size-3.5" />}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs">
      {children}
    </li>
  );
}

/**
 * A TONE3000 tone, laid out the way TONE3000's API terms ask: the picture,
 * title, gear type, format, creator and licence, unaltered, with the
 * "Powered by TONE3000" credit and a link to the tone's page.
 * @see docs/factory-collection.md
 */
function ToneSourceCard({
  source,
  className,
}: {
  source: Extract<BlockSource, { kind: 'tone3000' }>;
  className?: string;
}) {
  const profile = safeLink(source.creator.profile);
  const page = safeLink(source.page);
  const split = [
    source.counts?.a2 && `${source.counts.a2} A2`,
    source.counts?.standard && `${source.counts.standard} standard`,
    source.counts?.custom && `${source.counts.custom} custom`,
  ].filter(Boolean);
  return (
    <section
      data-slot="source-card"
      aria-label={`About ${source.title}`}
      className={cn(
        'grid gap-3 overflow-hidden rounded-lg border border-border bg-card p-3',
        className,
      )}
    >
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
        <ExpandablePicture source={source} className="size-20" />
        <div className="grid min-w-0 content-start gap-1.5">
          <span className="text-md leading-snug font-semibold [overflow-wrap:anywhere]">
            {source.title}
          </span>
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <CreatorBadge name={source.creator.name} />
            <Out href={profile}>{source.creator.name}</Out>
            {source.creator.username && (
              <span className="text-xs text-muted-foreground">
                @{source.creator.username}
              </span>
            )}
          </span>
        </div>
      </div>

      <ul
        aria-label="Details"
        className="m-0 flex list-none flex-wrap gap-1.5 p-0"
      >
        {source.gear && <Chip>{source.gear}</Chip>}
        {source.format && <Chip>{source.format}</Chip>}
        {source.models ? (
          <Chip>
            {source.models} {source.models === 1 ? 'model' : 'models'}
          </Chip>
        ) : null}
        <Chip>
          <span className="text-muted-foreground">Licence </span>
          {source.licence}
        </Chip>
      </ul>
      {split.length > 1 && (
        <p className="m-0 text-xs text-muted-foreground">
          Models: {split.join(' · ')}
        </p>
      )}

      <div className="-mx-3 -mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground">
        <a
          href="https://www.tone3000.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-touch items-center gap-1.5 text-foreground no-underline hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Powered by
          <img
            src="/brand/credits/tone3000.svg"
            alt="TONE3000"
            className="h-3.5 w-auto"
          />
        </a>
        {page && (
          <Out href={page} className="min-h-touch text-sm">
            View on TONE3000 <ArrowSquareOut aria-hidden="true" />
          </Out>
        )}
      </div>
    </section>
  );
}

/**
 * Everything about where a block comes from: its picture, name and maker,
 * the provider with its mark, links to the maker's profile and the source,
 * and the licence. For the block's full editor and Library details. A
 * picture that fails to load falls back to a plain glyph.
 */
export function SourceCard({
  source,
  className,
}: {
  source: BlockSource;
  className?: string;
}) {
  if (source.kind === 'tone3000')
    return <ToneSourceCard source={source} className={className} />;
  return (
    <section
      data-slot="source-card"
      aria-label={`About ${source.title}`}
      className={cn(
        'grid gap-3 rounded-lg border border-border bg-card p-3',
        className,
      )}
    >
      <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3">
        <SourcePicture source={source} />
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-md font-semibold">{source.title}</span>
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
            {maker(source) && source.kind !== 'oxidal' ? (
              <>by {maker(source)}</>
            ) : (
              <>Oxidal's own, from papers and our code</>
            )}
          </span>
          <ProviderMark source={source} className="justify-self-start" />
        </div>
      </div>

      <dl className="m-0 grid divide-y divide-border border-y border-border">
        {source.kind === 'file' && (
          <>
            <Fact label="File">
              {source.type === 'NAM' ? 'NAM capture' : 'Impulse response'},
              added by you
            </Fact>
            {source.gear && <Fact label="Gear">{source.gear}</Fact>}
            {source.audio && (
              <Fact label="Audio">
                {source.audio.sampleRate / 1000} kHz · {source.audio.bits}-bit ·{' '}
                {source.audio.channels === 1 ? 'mono' : 'stereo'} ·{' '}
                {source.audio.durationMs} ms
              </Fact>
            )}
            {source.fingerprint && (
              <Fact label="Fingerprint">
                <code className="text-xs">{source.fingerprint}</code>
              </Fact>
            )}
            {source.trainer && (
              <Fact label="Trained with">{source.trainer}</Fact>
            )}
          </>
        )}
        {source.kind === 'lv2' && (
          <>
            {source.category && <Fact label="Type">{source.category}</Fact>}
            <Fact label="Pack">
              {source.pack.name}
              {source.pack.version ? ` ${source.pack.version}` : ''}
              {source.pack.package ? ` · ${source.pack.package}` : ''}
            </Fact>
            {source.pack.licence && (
              <Fact label="Licence">{source.pack.licence}</Fact>
            )}
            {source.pack.qualification && (
              <Fact label="Tested">{source.pack.qualification}</Fact>
            )}
            {source.uri && (
              <Fact label="Plugin">
                <code className="text-xs">{source.uri}</code>
              </Fact>
            )}
          </>
        )}
        {source.kind === 'oxidal' && (
          <>
            <Fact label="Code">
              <code className="text-xs">{source.crate}</code> · Rust
            </Fact>
            <Fact label="Licence">{source.licence}</Fact>
            {source.references && source.references.length > 0 && (
              <Fact label="Built from">
                <ul className="m-0 grid gap-0.5 pl-4">
                  {source.references.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </Fact>
            )}
          </>
        )}
        {source.kind === 'engine' && (
          <Fact label="Part of">{source.engine}</Fact>
        )}
      </dl>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm [&_a]:min-h-touch">
        {source.kind === 'file' && safeLink(source.link) && (
          <Out href={safeLink(source.link)}>
            Where it came from <ArrowSquareOut aria-hidden="true" />
          </Out>
        )}
        {source.kind === 'lv2' && (
          <>
            {safeLink(source.homepage) && (
              <Out href={safeLink(source.homepage)}>
                {source.title} website <ArrowSquareOut aria-hidden="true" />
              </Out>
            )}
            <Out href={safeLink(source.pack.website)}>
              {source.pack.name} website <ArrowSquareOut aria-hidden="true" />
            </Out>
            {source.pack.copyright && (
              <Out
                className="min-h-touch"
                href={
                  /^\/api\/v1\/packs\/[a-z0-9-]+\/copyright$/.test(
                    source.pack.copyright,
                  )
                    ? source.pack.copyright
                    : undefined
                }
              >
                Licence and copyright <ArrowSquareOut aria-hidden="true" />
              </Out>
            )}
          </>
        )}
        {source.kind === 'oxidal' && (
          <>
            <Out href={safeLink(source.repo)}>
              <GithubLogo aria-hidden="true" /> Source code
            </Out>
            {source.references && (
              <Out
                href={safeLink(source.referencesUrl)}
                className="min-h-touch"
              >
                <BookOpen aria-hidden="true" /> REFERENCES.md in the crate
              </Out>
            )}
          </>
        )}
        {source.kind === 'engine' && safeLink(source.page) && (
          <Out href={safeLink(source.page)}>
            About the engine <ArrowSquareOut aria-hidden="true" />
          </Out>
        )}
      </div>
    </section>
  );
}
