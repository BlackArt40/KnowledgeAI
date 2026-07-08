import Link from "next/link";
import { Home, Search, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-30" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/20 blur-[100px]" />

      <Logo />

      <div className="relative mt-10 text-center">
        <p className="bg-brand-gradient bg-clip-text text-8xl font-black tracking-tighter text-transparent sm:text-9xl">
          404
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Compass className="h-5 w-5 animate-spin text-primary" style={{ animationDuration: "3s" }} />
          <h1 className="text-xl font-semibold">页面走丢了</h1>
        </div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          您访问的页面不存在或已被移动。请检查链接是否正确，或返回首页继续探索。
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="gradient" asChild>
          <Link href="/"><Home className="h-4 w-4" /> 返回首页</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/knowledge-base"><Search className="h-4 w-4" /> 前往知识库</Link>
        </Button>
      </div>
    </div>
  );
}
