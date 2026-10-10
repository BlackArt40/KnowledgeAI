"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

function navLinks(t: (k: string) => string) {
  return [
    { label: t("page.navbar.s2"), href: "/#features" },
    { label: t("page.navbar.s3"), href: "/#workflow" },
    { label: t("page.navbar.s4"), href: "/#pricing" },
    { label: t("page.navbar.s5"), href: "/docs" },
  ];
}

// 同页锚点（/#features 等）用原生 <a>，交给浏览器做片段导航；<Link> 会把 hash
// 交给客户端路由器记账，实测（Next 16.4）在以 #hash 载入后再点击会叠加成
// #features#features，二次点击同页刷新时还可能丢失 hash。跨页路由（/docs）保持 <Link>。
function NavItem({
  href,
  label,
  className,
  onClick,
}: {
  href: string;
  label: string;
  className: string;
  onClick?: () => void;
}) {
  if (href.startsWith("/#")) {
    return (
      <a href={href} className={className} onClick={onClick}>
        {label}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick}>
      {label}
    </Link>
  );
}

export function Navbar({ signedIn = false }: { signedIn?: boolean }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks(t).map((link) => (
            <NavItem
              key={link.href}
              href={link.href}
              label={link.label}
              className="rounded-full px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            />
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          {signedIn ? (
            <Button size="sm" className="rounded-full px-4" asChild>
              <Link href="/dashboard">{t("page.navbar.s7")}</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="rounded-full" asChild>
                <Link href="/login">{t("page.navbar.s0")}</Link>
              </Button>
              <Button size="sm" className="rounded-full px-4" asChild>
                <Link href="/register">{t("page.navbar.s1")}</Link>
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            aria-label={t("page.navbar.s6")}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background/95 p-4 backdrop-blur-xl md:hidden">
          <nav className="flex flex-col">
            {navLinks(t).map((link) => (
              <NavItem
                key={link.href}
                href={link.href}
                label={link.label}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              />
            ))}
          </nav>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
            {signedIn ? (
              <Button className="col-span-2" asChild>
                <Link href="/dashboard" onClick={() => setOpen(false)}>
                  {t("page.navbar.s7")}
                </Link>
              </Button>
            ) : (
              <>
                <Button variant="outline" asChild>
                  <Link href="/login" onClick={() => setOpen(false)}>
                    {t("page.navbar.s0")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/register" onClick={() => setOpen(false)}>
                    {t("page.navbar.s1")}
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
