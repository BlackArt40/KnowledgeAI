import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-md shadow-primary/30",
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path
          d="M5 4.5C5 3.67 5.67 3 6.5 3H14l5 5v11.5c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15Z"
          fill="currentColor"
          fillOpacity="0.25"
        />
        <path
          d="M14 3l5 5h-3.5A1.5 1.5 0 0 1 14 6.5V3Z"
          fill="currentColor"
          fillOpacity="0.6"
        />
        <path
          d="M8.5 12.2l2.2 2.2 3.8-3.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Logo({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex items-center gap-2.5 font-semibold tracking-tight",
        className
      )}
    >
      <LogoMark className="transition-transform group-hover:scale-105" />
      <span className="text-[17px]">
        Knowledge<span className="text-gradient">AI</span>
      </span>
    </Link>
  );
}
