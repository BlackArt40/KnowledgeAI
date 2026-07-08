"use client";

import * as React from "react";
import { MailCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
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

      <h1 className="mt-6 text-2xl font-bold tracking-tight">验证你的邮箱</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        我们已向 <span className="font-medium text-foreground">you@company.com</span>{" "}
        发送了一封验证邮件。
        <br />
        请点击邮件中的链接完成验证。
      </p>

      <div className="mt-8 space-y-3">
        <Button variant="gradient" size="lg" className="w-full">
          我已验证，进入工作台
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={countdown > 0}
          onClick={() => setCountdown(60)}
        >
          <RefreshCw className={countdown > 0 ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {countdown > 0 ? `重新发送（${countdown}s）` : "重新发送邮件"}
        </Button>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        没有收到邮件？请检查垃圾邮件文件夹，或{" "}
        <a href="#" className="text-primary hover:underline">
          联系支持
        </a>
      </p>
    </div>
  );
}
