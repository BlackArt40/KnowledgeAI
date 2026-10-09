import { cookies } from "next/headers";
import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";
import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { Workflow } from "@/components/marketing/workflow";
import { Pricing } from "@/components/marketing/pricing";
import { CTA } from "@/components/marketing/cta";
import { verifyToken } from "@/lib/auth/session";

export default async function Home() {
  // 头部导航需要反映登录态：已登录时显示「进入工作台」而不是「登录/免费开始」，
  // 否则从工作台点 Logo 回官网会像"登录状态丢了"。根布局已读 cookie（locale），
  // 这里再读会话不会改变渲染模式；token 无效/过期按未登录处理。
  // token 校验含一次 Redis 撤销检查（D1）：给渲染加超时上限，依赖异常时降级为
  // 未登录头部，绝不挂住首页（同健康/探针链路的超时约定）。
  const token = (await cookies()).get("kai-token")?.value;
  const user = token
    ? await Promise.race([
        verifyToken(token),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ])
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar signedIn={Boolean(user)} />
      <main className="flex-1">
        <Hero />
        <Features />
        <Workflow />
        <Pricing />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
