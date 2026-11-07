/**
 * Long work that runs in known steps reports which one is running (7.21):
 * "Step 2 of 3 · Saving details", with a bar that only moves when a step
 * finishes. No animation, so it suits reduced motion and e-paper.
 * @see docs/interface.md
 */
export function StepProgress({
  label,
  steps,
  current,
}: {
  /** What the whole job is, as in "Playing Iron Pulse". */
  label: string;
  steps: string[];
  /** Index of the running step. */
  current: number;
}) {
  const index = Math.max(0, Math.min(steps.length - 1, current));
  return (
    <div className="step-progress" role="status" aria-live="polite">
      <p>
        {label} · Step {index + 1} of {steps.length} · {steps[index]}
      </p>
      <progress aria-label={label} max={steps.length} value={index} />
    </div>
  );
}
