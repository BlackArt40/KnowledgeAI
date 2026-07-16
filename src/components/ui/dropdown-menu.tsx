"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Lightweight dropdown menu (no Radix dependency). Manages open state,
// click-outside / Escape to close, and closes on item click.

const Ctx = React.createContext<{ close: () => void } | null>(null);

export function DropdownMenu({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <Ctx.Provider value={{ close: () => setOpen(false) }}>
      <div ref={ref} className={cn("relative inline-block", className)}>
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {trigger}
        </div>
        {open && (
          <div
            className={cn(
              "absolute z-50 mt-1 min-w-[168px] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
              align === "end" ? "right-0" : "left-0"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function DropdownMenuItem({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}) {
  const ctx = React.useContext(Ctx);
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none",
        className
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(e);
        ctx?.close();
      }}
    >
      {children}
    </button>
  );
}
