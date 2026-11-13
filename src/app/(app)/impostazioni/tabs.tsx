import Link from "next/link";

const TABS = [
  { key: "porto", href: "/impostazioni", label: "Porto" },
  { key: "pontili", href: "/impostazioni/pontili", label: "Pontili e posti" },
  { key: "categorie", href: "/impostazioni/categorie", label: "Categorie" },
  { key: "utenti", href: "/impostazioni/utenti", label: "Utenti" },
  { key: "registro", href: "/impostazioni/registro", label: "Registro" },
] as const;

export function SettingsTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="no-print mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sezioni delle impostazioni">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-[15px] font-medium whitespace-nowrap ${
            t.key === current ? "border-buoy text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
