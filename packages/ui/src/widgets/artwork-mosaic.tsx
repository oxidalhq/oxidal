import { cn } from '../lib/cn';

/**
 * A preset's cover made of its models' pictures: one fills the square, two
 * split it, three put one large beside two, four or more make a grid whose
 * last tile counts the rest. The pictures ease in a little on hover.
 * @see docs/interface.md
 */
export function ArtworkMosaic({
  sources,
}: {
  /** Each picture and what it shows, read out as its name. */
  sources: { src: string; title: string }[];
}) {
  const shown = sources.slice(0, 4);
  const rest = sources.length - shown.length;
  const layout =
    shown.length === 1
      ? 'grid-cols-1'
      : shown.length === 2
        ? 'grid-cols-2'
        : 'grid-cols-2 grid-rows-2';
  return (
    <span className={cn('group/cover grid size-full gap-px bg-border', layout)}>
      {shown.map((source, i) => (
        <span
          key={source.src}
          className={cn(
            'relative overflow-hidden bg-card',
            shown.length === 3 && i === 0 && 'row-span-2',
          )}
        >
          <img
            src={source.src}
            alt={source.title}
            loading="lazy"
            className="size-full object-cover transition-transform duration-[var(--duration-base)] ease-out group-hover/cover:scale-105 motion-reduce:transition-none"
          />
          {rest > 0 && i === shown.length - 1 && (
            <span className="absolute inset-0 grid place-items-center bg-foreground/60 font-mono text-lg text-background">
              +{rest}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
