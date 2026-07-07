import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FloatWin } from "./core/types";

/* ---------- buttons ---------- */

export function Btn({ children, onClick, strong, big, pressed, disabled, title, ariaLabel, type = "button", className = "", style }: {
  children: ReactNode;
  onClick?: () => void;
  strong?: boolean;
  big?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  type?: "button" | "submit";
  className?: string;
  style?: CSSProperties;
}) {
  const classes = ["b98", strong ? "strong" : "", big ? "big" : "", pressed ? "pressed" : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} style={style}>
      {children}
    </button>
  );
}

/* ---------- title bar ---------- */

export function TitleBar({ icon, text, active = true, maroon, onClose, onMinimize, decor, onPointerDown, onClick }: {
  icon?: string;
  text: ReactNode;
  active?: boolean;
  maroon?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  decor?: boolean;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
}) {
  const classes = ["titlebar", active ? "" : "inactive", maroon ? "maroon" : ""].filter(Boolean).join(" ");
  const clickProps = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick: (event: React.MouseEvent<HTMLDivElement>) => {
          if ((event.target as HTMLElement).closest(".tb-controls")) return;
          onClick();
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }
      }
    : {};
  return (
    <div className={classes} onPointerDown={onPointerDown} {...clickProps}>
      <span className="tb-text">
        {icon && <span className="tb-icon">{icon}</span>}
        <span>{text}</span>
      </span>
      <span className="tb-controls">
        {decor && <span className="tb-btn" aria-hidden>_</span>}
        {onMinimize && <button className="tb-btn" onClick={onMinimize} aria-label="Minimize">_</button>}
        {decor && <span className="tb-btn" aria-hidden>×</span>}
        {onClose && <button className="tb-btn" onClick={onClose} aria-label="Close">×</button>}
      </span>
    </div>
  );
}

/* ---------- group box / fields / meters ---------- */

export function GroupBox({ legend, children, id, style }: { legend: ReactNode; children: ReactNode; id?: string; style?: CSSProperties }) {
  return (
    <fieldset className="gb" id={id} style={style}>
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

export function HeatMeter({ heat, pct }: { heat?: number; pct: number }) {
  return (
    <div className="heat-track" role="meter" aria-valuenow={heat ?? pct} aria-label="Harness Heat">
      <div className="heat-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/* ---------- tabs ---------- */

export function TabStrip<T extends string>({ tabs, active, onSelect }: { tabs: readonly T[]; active: T; onSelect: (tab: T) => void }) {
  return (
    <div className="tabs98" role="tablist">
      {tabs.map((tab) => (
        <button key={tab} role="tab" aria-selected={tab === active} className={`tab98 ${tab === active ? "on" : ""}`} onClick={() => onSelect(tab)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

/* ---------- menu bar ---------- */

export type MenuEntry = { icon?: string; label: ReactNode; onClick: () => void; checked?: boolean } | "sep";

export function MenuBar({ menus }: { menus: Array<{ key: string; label: ReactNode; items: MenuEntry[] }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState("");

  useEffect(() => {
    if (!open) return;
    function onDocDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen("");
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen("");
    }
    document.addEventListener("pointerdown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menubar" ref={ref}>
      {menus.map((menu) => (
        <span
          key={menu.key}
          role="button"
          tabIndex={0}
          className={`menu-item ${open === menu.key ? "open" : ""}`}
          onClick={() => setOpen(open === menu.key ? "" : menu.key)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(open === menu.key ? "" : menu.key);
            }
          }}
          onPointerEnter={() => { if (open) setOpen(menu.key); }}
        >
          {menu.label}
          {open === menu.key && (
            <div className="menu-pop">
              {menu.items.map((item, index) =>
                item === "sep" ? (
                  <div className="hsep" key={`sep-${index}`} />
                ) : (
                  <button
                    className="menu-row"
                    key={index}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); setOpen(""); item.onClick(); }}
                  >
                    <span className="mi">{item.checked ? "✓" : item.icon ?? ""}</span>
                    <span>{item.label}</span>
                  </button>
                )
              )}
            </div>
          )}
        </span>
      ))}
    </div>
  );
}

/* ---------- dialog ---------- */

export function Dialog({ title, icon, onClose, actions, children, wide, body }: {
  title: string;
  icon?: string;
  onClose: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
  body?: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" role="dialog" aria-label={title}>
      <div className={`win dialog98 ${wide ? "wide" : ""}`}>
        <TitleBar text={title} onClose={onClose} />
        {children ?? (
          <div className="dialog-body">
            {icon && <span className="di">{icon}</span>}
            <span>{body}</span>
          </div>
        )}
        <div className="dialog-actions">
          {actions ?? <Btn strong onClick={onClose}>OK</Btn>}
        </div>
      </div>
    </div>
  );
}

/* ---------- floating window ---------- */

const MOBILE_QUERY = "(max-width: 920px)";

export function FloatWindow({ win, zIndex, width, icon, title, active, maroon, onFocus, onClose, onMinimize, onMove, children }: {
  win: FloatWin;
  zIndex: number;
  width: number;
  icon: string;
  title: string;
  active: boolean;
  maroon?: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMove: (x: number, y: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    onFocus();
    if ((event.target as HTMLElement).closest(".tb-btn")) return;
    if (window.matchMedia(MOBILE_QUERY).matches) return;
    const el = ref.current;
    if (!el) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = win.x;
    const baseY = win.y;
    let nextX = baseX;
    let nextY = baseY;
    function move(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      nextX = Math.min(Math.max(baseX + ev.clientX - startX, 8 - width + 120), window.innerWidth - 60);
      nextY = Math.min(Math.max(baseY + ev.clientY - startY, 4), window.innerHeight - 80);
      el!.style.left = `${nextX}px`;
      el!.style.top = `${nextY}px`;
    }
    function end(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      onMove(nextX, nextY);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  return (
    <div
      ref={ref}
      className="win float-win"
      style={{ left: win.x, top: win.y, zIndex, width, maxWidth: "calc(100vw - 16px)", display: win.minimized ? "none" : undefined }}
      onPointerDown={onFocus}
    >
      <TitleBar icon={icon} text={title} active={active} maroon={maroon} onMinimize={onMinimize} onClose={onClose} onPointerDown={startDrag} />
      <div className="win-scroll">{children}</div>
    </div>
  );
}
