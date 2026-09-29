import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";
import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { Workflow } from "@/components/marketing/workflow";
import { Pricing } from "@/components/marketing/pricing";
import { CTA } from "@/components/marketing/cta";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
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
