import type { Plan } from "../agent/types.ts";

/**
 * The moment the whole product turns on. Before anything touches their files,
 * the person reads a list of sentences and presses a button. No paths, no
 * counts of bytes, no "are you sure?" — just what will happen, and a way out.
 */
export default function PlanCard({
  plan,
  onDecide,
}: {
  plan: Plan;
  onDecide: (approved: boolean) => void;
}) {
  const lines = plan.preview.length > 0 ? plan.preview : plan.changes.map((c) => c.kind);
  const shown = lines.slice(0, 8);
  const hidden = lines.length - shown.length;

  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--accent)", background: "var(--paper)" }}
    >
      <p className="font-semibold">{plan.summary}</p>

      <ul className="mt-3 space-y-1 text-sm" style={{ color: "var(--muted)" }}>
        {shown.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true">·</span>
            <span>{line}</span>
          </li>
        ))}
        {hidden > 0 && <li className="pl-4 italic">…and {hidden} more like this</li>}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onDecide(true)}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          Do it
        </button>
        <button
          onClick={() => onDecide(false)}
          className="rounded-lg border px-4 py-2 text-sm font-medium"
          style={{ borderColor: "var(--line)" }}
        >
          No thanks
        </button>
        <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
          You can undo this afterwards
        </span>
      </div>
    </div>
  );
}
