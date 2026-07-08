import Link from "next/link";
import { Wrench, Clock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function MaintenancePage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-30" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-warning/20 blur-[100px]" />

      <Logo />

      <div className="relative mt-10 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-warning/10">
          <Wrench className="h-10 w-10 text-warning" />
        </div>
        <h1 className="mt-6 text-2xl font-bold">系统维护中</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          我们正在对 KnowledgeAI 进行升级维护，以提供更好的服务体验。维护预计很快完成，请稍后重试。
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>预计恢复时间：约 30 分钟</span>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" asChild>
          <a href="mailto:support@knowledgeai.dev"><Mail className="h-4 w-4" /> 联系支持</a>
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/">刷新页面</Link>
        </Button>
      </div>
    </div>
  );
}
