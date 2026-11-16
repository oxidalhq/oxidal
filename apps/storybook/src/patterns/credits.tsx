import { cn } from '@/lib/cn';

export type Credit = {
  name: string;
  /** "Powered by", "Built with", "Icons by" … */
  role: string;
  href: string;
  /** A logo under /brand/credits/; without one the badge sets the name in type. */
  logo?: string;
  /** The logo is a single-colour mark to draw in the badge's ink. */
  mono?: boolean;
  /** The logo already spells the name. */
  wordmark?: boolean;
};

/**
 * Acknowledgements as badges with each project's own logo where its terms
 * allow one, and a typographic badge otherwise. TONE3000's catalogue and
 * NAM are credited everywhere their work appears; the stack is credited
 * on About. Logos stay unmodified and link to the project.
 */
export function CreditBadge({
  credit,
  dark = false,
  className,
}: {
  credit: Credit;
  dark?: boolean;
  className?: string;
}) {
  return (
    <a
      data-slot="credit"
      href={credit.href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${credit.role} ${credit.name}`}
      className={cn(
        'grid min-w-32 gap-0.5 rounded-lg border px-3.5 py-2 text-center no-underline transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2',
        dark
          ? 'border-enclosure-border text-enclosure-foreground hover:border-enclosure-foreground focus-visible:outline-enclosure-foreground'
          : 'border-border bg-card text-foreground hover:border-foreground focus-visible:outline-ring',
        className,
      )}
    >
      <span className="small-caps text-xs font-medium opacity-70">
        {credit.role}
      </span>
      <span className="flex h-7 items-center justify-center gap-1.5">
        {credit.logo ? (
          credit.mono ? (
            <span
              aria-hidden="true"
              className="inline-block h-5 w-5 bg-current"
              style={{
                maskImage: `url(/brand/credits/${credit.logo})`,
                maskSize: 'contain',
                maskRepeat: 'no-repeat',
                maskPosition: 'center',
                WebkitMaskImage: `url(/brand/credits/${credit.logo})`,
                WebkitMaskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
              }}
            />
          ) : (
            <img
              src={`/brand/credits/${credit.logo}`}
              alt=""
              className={cn('h-5 w-auto', credit.wordmark && 'h-4')}
            />
          )
        ) : null}
        {!credit.wordmark && (
          <span className="text-md font-bold tracking-tight">
            {credit.name}
          </span>
        )}
      </span>
    </a>
  );
}

export function Credits({
  credits,
  dark = false,
  className,
}: {
  credits: Credit[];
  dark?: boolean;
  className?: string;
}) {
  return (
    <ul
      aria-label="Credits"
      className={cn(
        'm-0 flex list-none flex-wrap justify-center gap-2 p-0',
        className,
      )}
    >
      {credits.map((credit) => (
        <li key={credit.name}>
          <CreditBadge credit={credit} dark={dark} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The one-line credit beside a tone that came from TONE3000: the wordmark,
 * the creator's name, and the capture's licence, each linking out. Shown
 * wherever a catalogue tone appears: Library rows, the block editor, the
 * stage's preset line.
 */
export function PoweredByTone3000({
  creator,
  licence,
  href = 'https://www.tone3000.com',
  className,
}: {
  creator?: { name: string; href?: string };
  licence?: { name: string; href?: string };
  href?: string;
  className?: string;
}) {
  return (
    <span
      data-slot="powered-by"
      className={cn(
        'inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 small-caps text-xs text-muted-foreground',
        className,
      )}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-foreground no-underline hover:underline"
      >
        Powered by{' '}
        <img
          src="/brand/credits/tone3000.svg"
          alt="TONE3000"
          className="h-3 w-auto"
        />
      </a>
      {creator && (
        <>
          <span aria-hidden="true">·</span>
          {creator.href ? (
            <a
              href={creator.href}
              target="_blank"
              rel="noreferrer"
              className="text-foreground no-underline hover:underline"
            >
              {creator.name}
            </a>
          ) : (
            <span>{creator.name}</span>
          )}
        </>
      )}
      {licence && (
        <>
          <span aria-hidden="true">·</span>
          {licence.href ? (
            <a
              href={licence.href}
              target="_blank"
              rel="noreferrer"
              className="no-underline hover:underline"
            >
              {licence.name}
            </a>
          ) : (
            <span>{licence.name}</span>
          )}
        </>
      )}
    </span>
  );
}
