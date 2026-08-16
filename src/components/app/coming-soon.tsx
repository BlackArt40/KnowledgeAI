import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n/provider";

export function ComingSoon({
  icon: Icon,
  title,
  desc,
  week,
  features,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  week: string;
  features: string[];
}) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-12 text-center">
      <div className="relative">
        <div className="absolute inset-0 -z-10 aurora opacity-40 blur-2xl" />
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-8 w-8" />
        </span>
      </div>

      <Badge variant="warning" className="mt-6">
        {t("page.coming-soon.s0", { week })}
      </Badge>
      <h2 className="mt-4 text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {desc}
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-2">
        {features.map((f) => (
          <div
            key={f}
            className="rounded-xl border border-border bg-card p-4 text-sm"
          >
            <span className="font-medium">{f}</span>
          </div>
        ))}
      </div>

      <Button variant="outline" className="mt-8" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" /> {t("page.coming-soon.s1")}
        </Link>
      </Button>
    </div>
  );
}
