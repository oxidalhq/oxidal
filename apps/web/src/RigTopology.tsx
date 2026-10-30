import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { PortableGraph } from './generated/contract';
import { rigTopology } from './routingLayout';
const width = 104,
  height = 132,
  gapX = 36,
  gapY = 16;
export function RigTopology({
  graph,
  visible,
  selected,
  children,
}: {
  graph: PortableGraph;
  visible: string[];
  selected?: string;
  children: (id: string, index: number) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => rigTopology(graph, visible), [graph, visible]);
  const positions = new Map(
    layout.nodes.map((n) => [
      n.id,
      { x: n.column * (width + gapX), y: n.row * (height + gapY) },
    ]),
  );
  const selectedX = positions.get(selected ?? '')?.x;
  useEffect(() => {
    const el = viewport.current;
    if (!el || selectedX === undefined) return;
    if (selectedX < el.scrollLeft) el.scrollLeft = selectedX;
    else if (selectedX + width > el.scrollLeft + el.clientWidth)
      el.scrollLeft = selectedX + width - el.clientWidth;
  }, [selectedX]);
  const canvasWidth = Math.max(
    0,
    ...layout.nodes.map((n) => (n.column + 1) * (width + gapX) - gapX),
  );
  const canvasHeight = Math.max(
    0,
    ...layout.nodes.map((n) => (n.row + 1) * (height + gapY) - gapY),
  );
  // Scene presets draw their lanes elsewhere; nothing left means no section.
  if (!layout.nodes.length && layout.valid) return null;
  return (
    <div className="mixed-routing">
      <div
        ref={viewport}
        className="mixed-routing-scroll"
        tabIndex={0}
        role="region"
        aria-label="Mixed signal chain"
      >
        <div
          className="mixed-routing-canvas"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          <svg
            width={canvasWidth}
            height={canvasHeight}
            className="mixed-routing-lines"
            aria-hidden="true"
          >
            {layout.links.map((link) => {
              const from = positions.get(link.from)!,
                to = positions.get(link.to)!;
              const x = from.x + width,
                y = from.y + height / 2,
                endY = to.y + height / 2;
              // Right-angle wires turn in the gap before the target column, so
              // links fanning out of (or into) one node share a single bar.
              const bend = to.x - gapX / 2;
              return (
                <path
                  key={`${link.from}:${link.to}`}
                  d={`M ${x} ${y} H ${bend} V ${endY} H ${to.x}`}
                />
              );
            })}
          </svg>
          {layout.nodes.map((node, index) => (
            <div
              key={node.id}
              className="mixed-routing-node"
              style={{
                left: positions.get(node.id)!.x,
                top: positions.get(node.id)!.y,
                width,
                height,
              }}
            >
              {children(node.id, index)}
            </div>
          ))}
        </div>
      </div>
      {!layout.valid && (
        <p role="status" className="caption">
          Routing unavailable · controls remain accessible.
        </p>
      )}
    </div>
  );
}
