import type { RegistryItem } from "./types";

export function keyFor(item: Pick<RegistryItem, "owner" | "name">) {
  return `${item.owner}/${item.name}`;
}

/* per handoff: n>=1000 → (n/1000).toFixed(1)+'k' */
export function fmtK(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/* per handoff: heatPct = min(100, round(heat/30*100)) */
export function heatPct(heat: number) {
  return Math.min(100, Math.round((heat / 30) * 100));
}

export function relativeTime(value: string) {
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function isoWeek(date: Date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function clockLabel(date: Date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ap = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ap}`;
}

export function cleanReadme(readme?: string) {
  if (!readme) return "";
  const body = readme
    .replace(/^# .*\n+/, "")
    .split(/\n##\s+/)[0]
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("- "));
  return body.slice(0, 4).join(" ");
}
