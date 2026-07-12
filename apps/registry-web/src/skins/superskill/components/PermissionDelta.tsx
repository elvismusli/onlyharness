import type { PermissionDelta as PermissionDeltaData } from "../../../core/superskill-types";

type Risk = "low" | "elevated" | "critical";

const HUMAN: Record<string, { consequence: string; risk: Risk }> = {
  shell: { consequence: "Can run shell commands on your machine", risk: "critical" },
  moneyMovement: { consequence: "Can initiate money movement", risk: "critical" },
  externalSend: { consequence: "Can send data outside your workspace", risk: "critical" },
  credentials: { consequence: "Can receive runtime credentials", risk: "critical" },
  browser: { consequence: "Can operate a browser", risk: "elevated" },
  filesystem: { consequence: "Can read or change files in the project", risk: "elevated" },
  network: { consequence: "Can connect to network services", risk: "elevated" },
  userData: { consequence: "Can process user data", risk: "elevated" }
};

export function PermissionDelta({ delta }: { delta: PermissionDeltaData }) {
  if (delta.status === "known" && delta.added.length === 0) {
    return <div className="ss-delta ss-delta--empty"><strong>✓ No new permissions</strong><span>The compared managed setup already grants these powers.</span></div>;
  }
  return (
    <section className="ss-delta" aria-labelledby="ss-delta-title">
      <h3 id="ss-delta-title">Permission delta</h3>
      {delta.added.length ? <PowerList title="New powers" powers={delta.added} /> : <p>No candidate powers were reported.</p>}
      {delta.unchanged.length ? <PowerList title="Already known" powers={delta.unchanged} dim /> : null}
      {delta.status !== "known" ? (
        <div className="ss-delta-unknown">
          <strong>Unknown baseline</strong>
          <span>{delta.unknownBecause || "The client setup contains unmanaged or unreported permissions, so this is not an exact delta."}</span>
        </div>
      ) : null}
    </section>
  );
}

function PowerList({ title, powers, dim = false }: { title: string; powers: string[]; dim?: boolean }) {
  return (
    <div className={dim ? "ss-power-group ss-power-group--dim" : "ss-power-group"}>
      <div className="ss-evidence-label">{title}</div>
      <ul>
        {powers.map((power) => {
          const known = HUMAN[power] ?? { consequence: humanize(power), risk: "low" as const };
          return <li key={power} data-risk={known.risk}><span>{known.risk}</span>{known.consequence}</li>;
        })}
      </ul>
    </div>
  );
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, (char) => char.toUpperCase());
}
