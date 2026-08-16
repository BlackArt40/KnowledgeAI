"use client";

import { useT } from "@/lib/i18n/provider";

import * as React from "react";
import { MailCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
  const t = useT();
  const [countdown, setCountdown] = React.useState(0);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  return (
    <div className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MailCheck className="h-8 w-8" />
      </div>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">{t("page.verify-email.s0")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {t("page.verify-email.s2")} <span className="font-medium text-foreground">you@company.com</span>{" "}
        {t("page.verify-email.s3")}
        <br />
        {t("page.verify-email.s4")}
      </p>

      <div className="mt-8 space-y-3">
        <Button variant="gradient" size="lg" className="w-full">
          {t("page.verify-email.s5")}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={countdown > 0}
          onClick={() => setCountdown(60)}
        >
          <RefreshCw className={countdown > 0 ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {countdown > 0 ? t("page.verify-email.s1", { s: countdown }) : t("page.verify-email.s6")}
        </Button>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        {t("page.verify-email.s7")}{" "}
        <a href="#" className="text-primary hover:underline">
          {t("page.verify-email.s8")}
        </a>
      </p>
    </div>
  );
}
