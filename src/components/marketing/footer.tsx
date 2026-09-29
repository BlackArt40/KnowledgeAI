"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/provider";
import { Logo } from "@/components/logo";

export function Footer() {
  const t = useT();
  const links = [
    { label: t("page.navbar.s2"), href: "/#features" },
    { label: t("page.navbar.s4"), href: "/#pricing" },
    { label: t("page.navbar.s5"), href: "/docs" },
    { label: t("page.footer.s15"), href: "/privacy" },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <Logo />
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} KnowledgeAI
        </p>
      </div>
    </footer>
  );
}
