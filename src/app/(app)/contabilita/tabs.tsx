import Link from "next/link";

const TABS = [
  { key: "scadenziario", href: "/contabilita", label: "Scadenziario" },
  { key: "prima-nota", href: "/contabilita/prima-nota", label: "Prima nota" },
  { key: "riepilogo", href: "/contabilita/riepilogo", label: "Riepilogo" },
] as const;

export function AccountingTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="no-print mb-5 flex gap-1 border-b border-line" aria-label="Sezioni della contabilità">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-[15px] font-medium ${
            t.key === current ? "border-buoy text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
