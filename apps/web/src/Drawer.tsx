import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native dialog owns keyboard focus, Escape and restoration to its trigger. */
export function Drawer({ title, onClose, children, variant = "drawer" }: { title: string; onClose: () => void; children: ReactNode; variant?: "drawer" | "modal" }): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.showModal();
    return () => { dialog.close(); trigger?.focus(); };
  }, []);
  return <dialog ref={ref} className={variant} aria-labelledby={id} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="panel-heading"><h2 id={id}>{title}</h2><button type="button" aria-label="关闭" onClick={onClose}>关闭</button></header>
    <div className="drawer-body">{children}</div>
  </dialog>;
}
