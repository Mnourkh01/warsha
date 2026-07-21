import { useEffect, type RefObject } from "react";

// Dialog a11y in one place: initial focus, Tab cycling inside the container, and focus
// restore to the opener on close. Render it INSIDE the dialog markup so its effect runs
// exactly when the dialog mounts/unmounts (our dialogs render null when closed).
export function DialogTrap({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;

    const focusables = () =>
      [
        ...el.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((f) => f.offsetParent !== null);

    if (!el.contains(document.activeElement)) focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [containerRef]);
  return null;
}
