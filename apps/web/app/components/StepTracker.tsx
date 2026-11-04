const STEPS = ["Describe", "Approve rules", "Pick an offer", "Hold payment", "Result"] as const;

export type StepIndex = 0 | 1 | 2 | 3 | 4;

/** `current` is the active step. `failedAt` marks a step as blocked (used for a blocked result). */
export default function StepTracker({ current, failedAt, labels }: { current: number; failedAt?: number; labels?: readonly string[] }) {
  const STEP_LABELS = labels ?? STEPS;
  return (
    <ol className="pp-steps" aria-label="Progress" style={{ listStyle: "none", padding: 0 }}>
      {STEP_LABELS.map((label, index) => {
        const state = failedAt === index ? "bad" : index < current ? "done" : index === current ? "active" : "todo";
        return (
          <li key={label} style={{ display: "contents" }}>
            <span className="pp-step" data-state={state} {...(index === current ? { "aria-current": "step" as const } : {})}>
              <span className="pp-step-dot">{state === "done" ? "✓" : state === "bad" ? "!" : index + 1}</span>
              {label}
            </span>
            {index < STEP_LABELS.length - 1 && <span className="pp-step-sep" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
