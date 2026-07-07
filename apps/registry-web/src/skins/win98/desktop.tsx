import { useEffect, useRef, useState } from "react";
import { isoWeek } from "../../core/format";
import type { RegistryItem } from "../../core/types";
import { Btn, Dialog, TitleBar } from "./win98";

const PALETTE = ["#000000", "#808080", "#800000", "#808000", "#008000", "#008080", "#000080", "#800080", "#ffffff", "#c0c0c0", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"];
const BAR_COLORS = ["#ff0000", "#0000ff", "#00a000", "#ffff00"];

export function DesktopIcons({ onMyHarnesses, onNetwork, onBin }: { onMyHarnesses: () => void; onNetwork: () => void; onBin: () => void }) {
  return (
    <div className="desk-icons">
      <button className="desk-icon" onClick={onMyHarnesses}>
        <span className="glyph">🗂️</span>
        <span className="label">Resource Catalog</span>
      </button>
      <button className="desk-icon" onClick={onNetwork}>
        <span className="glyph">🌐</span>
        <span className="label">Network Neighborhood</span>
      </button>
      <button className="desk-icon" onClick={onBin}>
        <span className="glyph">🗑️</span>
        <span className="label">Remix Bin</span>
      </button>
    </div>
  );
}

export function AwardWindow({ leader }: { leader?: RegistryItem }) {
  return (
    <div className="win small award-win">
      <TitleBar text="🤠 Wild West Awards" maroon decor />
      <div className="award-body">
        <div className="cup">🏆</div>
        <div className="award-title">{leader ? "Best Harness in the Wild West" : "Leaderboard hidden"}</div>
        <div className="award-sub">Week {isoWeek(new Date())} · {leader?.title ?? "waiting for real signals"}</div>
      </div>
    </div>
  );
}

export function PaintWindow({ items }: { items: RegistryItem[] }) {
  const bars = items.slice(0, 4);
  return (
    <div className="win small paint-win">
      <TitleBar text="🎨 harness_heat.bmp — Paint" decor />
      <div className="paint-row">
        <div className="paint-tools">
          {["✏️", "🪣", "▭", "🖌️"].map((tool) => <span key={tool} className="paint-tool">{tool}</span>)}
        </div>
        <div className="paint-canvas">
          {!bars.length && <div style={{ fontSize: 11, color: "#404040" }}>collecting signals</div>}
          {bars.map((item, index) => (
            <div
              key={`${item.owner}/${item.name}`}
              className="paint-bar"
              title={`${item.title} · heat ${item.heat.toFixed(1)}`}
              style={{ height: `${Math.max(18, Math.min(92, (item.heat / 30) * 100))}%`, background: BAR_COLORS[index % BAR_COLORS.length] }}
            />
          ))}
        </div>
      </div>
      <div className="paint-palette">
        {PALETTE.map((color) => <span key={color} className="paint-chip" style={{ background: color }} />)}
      </div>
    </div>
  );
}

export function Mascot({ onYes }: { onYes: () => void }) {
  const [mood, setMood] = useState<"ship" | "fine" | "hidden">("hidden");
  return (
    <div className="mascot">
      {mood !== "hidden" && (
        <div className="bubble">
          {mood === "ship" ? (
            <>
              It looks like you're shipping an agent harness! Want to make it go <b>BUGAGA</b>?
              <div className="bubble-actions">
                <Btn onClick={() => { setMood("hidden"); onYes(); }}>Yes</Btn>
                <Btn onClick={() => setMood("fine")}>No</Btn>
              </div>
            </>
          ) : (
            <>Fine. I'll just bob here. Menacingly.</>
          )}
        </div>
      )}
      <button className="clip" onClick={() => setMood(mood === "hidden" ? "ship" : "hidden")} aria-label="Assistant">🧷</button>
    </div>
  );
}

export type TaskEntry = { id: string; icon: string; title: string; active: boolean; onClick: () => void };

export function Taskbar({ tasks, startOpen, onStart, time, onTrayFire }: {
  tasks: TaskEntry[];
  startOpen: boolean;
  onStart: () => void;
  time: string;
  onTrayFire: () => void;
}) {
  return (
    <div className="taskbar">
      <button className={`start-btn ${startOpen ? "on" : ""}`} onClick={onStart}>
        <span style={{ fontSize: 15 }}>🪟</span> Start
      </button>
      <div className="vsep" />
      <div className="scroller">
        {tasks.map((task) => (
          <button key={task.id} className={`task-btn ${task.active ? "on" : ""}`} onClick={task.onClick} title={task.title}>
            {task.icon} {task.title}
          </button>
        ))}
      </div>
      <div className="tray">
        <button title="Volume">🔊</button>
        <button title="Leaderboard" onClick={onTrayFire}>🔥</button>
        <span>{time}</span>
      </div>
    </div>
  );
}

export type StartEntry = { icon: string; label: string; onClick: () => void } | "sep";

export function StartMenu({ items, onClose }: { items: StartEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDocDown(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest(".start-btn")) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="startmenu" ref={ref}>
      <div className="start-spine">OnlyHarness 98</div>
      <div className="start-items">
        {items.map((item, index) =>
          item === "sep" ? (
            <div className="hsep" key={`sep-${index}`} style={{ margin: "2px 6px" }} />
          ) : (
            <button key={item.label} className="start-row" onClick={() => { onClose(); item.onClick(); }}>
              <span className="mi">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}

/* ---------- Log On dialog (plain tone: credentials are a no-joke zone) ---------- */

export function LogonDialog({ note, status, busy, configured, onSignIn, onSignUp, onResendConfirmation, onClose }: {
  note: string;
  status: string;
  busy: boolean;
  configured: boolean;
  onSignIn: (email: string, password: string) => void;
  onSignUp: (name: string, email: string, password: string) => void;
  onResendConfirmation: (email: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit() {
    if (mode === "in") onSignIn(email, password);
    else onSignUp(name, email, password);
  }

  return (
    <Dialog
      title={mode === "in" ? "Log On to OnlyHarness" : "Create your account"}
      onClose={onClose}
      wide
      actions={
        <>
          <Btn strong onClick={submit} disabled={busy || !configured}>{busy ? "..." : "OK"}</Btn>
          <Btn onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Sign up..." : "Log on..."}</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
        </>
      }
    >
      <div className="dialog-body" style={{ paddingBottom: 8 }}>
        <span className="di">🔑</span>
        <span>{note || "Type your email and password to log on to OnlyHarness."}</span>
      </div>
      <div className="logon-form">
        {mode === "up" && (
          <div className="logon-row">
            <span>Display name:</span>
            <div className="field98"><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" /></div>
          </div>
        )}
        <div className="logon-row">
          <span>Email:</span>
          <div className="field98"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></div>
        </div>
        <div className="logon-row">
          <span>Password:</span>
          <div className="field98">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) submit(); }}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
            />
          </div>
        </div>
        {!configured && <p className="logon-note">Auth backend is not configured in this environment.</p>}
        {status && <p className="logon-status">{status}</p>}
        {mode === "in" && (
          <p className="logon-note">
            <button className="linklike" type="button" disabled={busy || !configured} onClick={() => onResendConfirmation(email)}>
              Resend confirmation email
            </button>
          </p>
        )}
        <p className="logon-note">Your account stores stars and thread posts. Remix recipes stay local.</p>
      </div>
    </Dialog>
  );
}
