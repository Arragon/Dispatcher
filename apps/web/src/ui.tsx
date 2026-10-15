import { useId, useRef, type ReactNode } from "react";

export type IconName = "overview" | "task" | "plus" | "plug" | "model" | "device" | "branch" | "link" | "shield" | "pulse" | "settings" | "spark" | "book" | "search" | "bell" | "moon" | "sun" | "chevron" | "menu" | "close" | "refresh" | "check" | "warning" | "logout" | "folder" | "download" | "arrow";
const paths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="6" height="7" rx="1"/><rect x="15" y="3" width="6" height="4" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="13" width="6" height="8" rx="1"/></>,
  task: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 8 1 1 2-2m2 1h3M8 14h2m3 0h3M8 18h8"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  plug: <><path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4"/></>,
  model: <><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4" rx="1"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/></>,
  device: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/></>,
  branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-10v2a5 5 0 0 1-5 5H6"/></>,
  link: <><path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 1)"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  pulse: <path d="M2 12h5l3-8 4 16 3-8h5"/>,
  settings: <><path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3H9Z"/><circle cx="12" cy="11" r="3"/></>,
  spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>,
  book: <><path d="M12 5c-4-3-8-2-9-1v15c3-1 6-1 9 1m0-15c4-3 8-2 9-1v15c-3-1-6-1-9 1V5Z"/></>,
  search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
  bell: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 4h4"/></>,
  moon: <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  warning: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v1"/></>,
  logout: <><path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h13"/></>,
  folder: <path d="M3 7V5h7l2 3h9v12H3V7Z"/>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
};
export function Icon({ name, size = 17, className = "" }: { name: IconName; size?: number; className?: string }): React.JSX.Element {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function ProviderMark({ provider }: { provider: string }): React.JSX.Element {
  const marks: Record<string, string> = { codex: "⌘", cursor: "C", qoder: "Q", "qoder-cn": "Q", opencode: "oc", kiro: "K", devin: "D", pi: "π", grok: "𝕏", "grok-build": "𝕏", "workbuddy-cli": "W", "workbuddy-codebuddy": "W", workbuddy: "W", codebuddy: "B", "github-copilot": "GH" };
  return <span className={`provider-mark provider-${provider}`}>{marks[provider] ?? provider.slice(0, 2).toUpperCase()}</span>;
}
export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" | "error" }): React.JSX.Element {
  return <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}><Icon name={tone === "neutral" ? "shield" : "warning"} /><div>{children}</div></div>;
}
export function EmptyState({ title, children, icon = "task" }: { title: string; children?: ReactNode; icon?: IconName }): React.JSX.Element {
  return <div className="empty-inline"><span className="empty-icon"><Icon name={icon} size={24}/></span><strong>{title}</strong>{children}</div>;
}
export function Tabs({ items, value, onChange, label }: { items: ReadonlyArray<readonly [string, string]>; value: string; onChange: (value: string) => void; label: string }): React.JSX.Element {
  const id = useId();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  return <div className="view-tabs" role="tablist" aria-label={label}>{items.map(([key,text],index) => <button ref={(node) => { buttons.current[key] = node; }} id={`${id}-${key}`} key={key} role="tab" aria-selected={value === key} tabIndex={value === key ? 0 : -1} onClick={() => onChange(key)} onKeyDown={(event) => {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    event.preventDefault();
    const next = items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length]?.[0];
    if (next) { onChange(next); buttons.current[next]?.focus(); }
  }}>{text}</button>)}</div>;
}
