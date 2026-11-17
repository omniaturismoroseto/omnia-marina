import type { Metadata } from "next";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
  Anchor,
  ArrowRight,
  FileText,
  Flag,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Map,
  Sailboat,
  Settings,
  Tags,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { page } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { requireMarina } from "@/lib/context";
import { guideFor, type GuideIcon } from "@/lib/guide";
import { ROLE_LABEL } from "@/lib/labels";
import { ScrollToHash } from "./scroll-to-hash";

export const metadata: Metadata = { title: "Guida" };

const ICONS: Record<GuideIcon, LucideIcon> = {
  start: Flag,
  dashboard: LayoutDashboard,
  dock: Anchor,
  map: Map,
  owners: Users,
  boats: Sailboat,
  contracts: FileText,
  messages: Mail,
  accounting: Wallet,
  tariffs: Tags,
  settings: Settings,
  account: UserRound,
  help: LifeBuoy,
};

// I nomi di pulsanti e pagine, scritti tra «», in evidenza.
function rich(text: string): ReactNode {
  return text.split(/(«[^»]+»)/).map((part, i) =>
    part.startsWith("«") ? (
      <strong key={i} className="font-semibold text-ink">
        {part}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export default page(async function GuidePage() {
  const ctx = await requireMarina();
  const sections = guideFor(ctx.role);

  return (
    <>
      <PageHeader
        title="Guida"
        description={
          <>
            Istruzioni pratiche per iniziare, sezione per sezione. Vedi le parti che riguardano il tuo ruolo:{" "}
            <strong className="font-medium text-ink">{ROLE_LABEL[ctx.role]}</strong>.
          </>
        }
        actions={<PrintButton label="Stampa o salva PDF" />}
      />

      <nav aria-label="Sezioni della guida" className="no-print mb-6 flex flex-wrap gap-2">
        {sections.map((s) => {
          const Icon = ICONS[s.icon];
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-ink hover:border-sea"
            >
              <Icon size={15} aria-hidden="true" className="text-sea" />
              {s.title}
            </a>
          );
        })}
      </nav>

      <div className="space-y-5 print:space-y-4">
        {sections.map((s) => {
          const Icon = ICONS[s.icon];
          return (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="card scroll-mt-20 p-5 print:shadow-none">
              {/* In stampa il titolo resta sulla stessa pagina dei suoi passaggi. */}
              <div className="print:break-inside-avoid">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sea-soft text-sea" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <h2 id={`${s.id}-title`} className="font-display text-xl leading-tight font-semibold text-ink">
                      {s.title}
                    </h2>
                    <p className="mt-0.5 text-[15px] text-muted">{rich(s.purpose)}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-5 md:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]">
                  {s.steps.map((group) => (
                    <div key={group.title}>
                      <h3 className="text-sm font-semibold tracking-wide text-sea-dark uppercase">{group.title}</h3>
                      <ol className="mt-2 space-y-2">
                        {group.items.map((item, n) => (
                          <li key={n} className="flex gap-2.5 text-[15px] leading-snug text-ink/90">
                            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-deep text-[11px] font-semibold text-white tabular-nums">
                              {n + 1}
                            </span>
                            <span>{rich(item)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </div>

              {s.tips && s.tips.length > 0 && (
                <div className="mt-4 rounded-md bg-paper px-4 py-3 print:break-inside-avoid">
                  <p className="text-sm font-semibold text-ink">Da sapere</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                    {s.tips.map((t, n) => (
                      <li key={n}>{rich(t)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {s.link && (
                <Link href={s.link.href} className="link no-print mt-4 inline-flex items-center gap-1 text-sm font-medium">
                  {s.link.label}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              )}
            </section>
          );
        })}
      </div>

      <p className="mt-6 text-sm text-muted">
        Ogni pagina principale ha in alto, accanto al titolo, il collegamento <strong className="font-medium text-ink">Guida</strong> che porta alla parte
        giusta di questa pagina.
      </p>
      <ScrollToHash />
    </>
  );
});
