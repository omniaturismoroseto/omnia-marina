"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloudSun, Mail, Sailboat, Wallet, type LucideIcon } from "lucide-react";

// Schede dell'area diportista: sul telefono stanno in basso, sullo schermo largo sotto la barra in alto.
const ITEMS: { href: string; label: string; icon: LucideIcon; key: "home" | "messaggi" | "meteo" | "conto" }[] = [
  { href: "/diportista", label: "La mia barca", icon: Sailboat, key: "home" },
  { href: "/diportista/messaggi", label: "Messaggi", icon: Mail, key: "messaggi" },
  { href: "/diportista/meteo", label: "Meteo", icon: CloudSun, key: "meteo" },
  { href: "/diportista/conto", label: "Conto", icon: Wallet, key: "conto" },
];

function active(pathname: string, href: string) {
  return href === "/diportista" ? pathname === href || pathname.startsWith("/diportista/contratti") || pathname === "/diportista/account" : pathname.startsWith(href);
}

export function OwnerNav({ unread }: { unread: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Area diportista" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card sm:static sm:border-t-0 sm:bg-transparent">
      <ul className="mx-auto flex max-w-3xl sm:gap-1 sm:px-6">
        {ITEMS.map(({ href, label, icon: Icon, key }) => {
          const on = active(pathname, href);
          return (
            <li key={href} className="flex-1 sm:flex-none">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[11px] sm:flex-row sm:gap-2 sm:rounded-t-md sm:px-3 sm:py-2.5 sm:text-sm ${
                  on ? "font-semibold text-sea-dark sm:bg-paper sm:text-ink" : "text-muted sm:text-white/75 sm:hover:text-white"
                }`}
              >
                <Icon size={20} aria-hidden="true" className="sm:size-4" />
                {label}
                {key === "messaggi" && unread > 0 && (
                  <span className="absolute top-1 right-[calc(50%-1.4rem)] min-w-[1.1rem] rounded-full bg-buoy px-1 text-center text-[10px] leading-[1.1rem] font-semibold text-white sm:static sm:ml-0.5">
                    {unread}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
