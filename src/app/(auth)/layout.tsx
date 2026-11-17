import { BrandLogo } from "@/components/brand";

// Cornice delle pagine di accesso: pannello blu con le linee di rotta di una carta nautica.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="relative hidden overflow-hidden bg-deep text-white lg:block">
        <svg className="absolute inset-0 h-full w-full text-white" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g stroke="currentColor" strokeOpacity="0.09" strokeWidth="1" fill="none">
            {Array.from({ length: 16 }, (_, i) => {
              const a = (i * Math.PI) / 8;
              return <line key={i} x1="430" y1="560" x2={430 + Math.cos(a) * 1200} y2={560 + Math.sin(a) * 1200} />;
            })}
            <circle cx="430" cy="560" r="90" />
            <circle cx="430" cy="560" r="180" strokeDasharray="2 6" />
            <circle cx="430" cy="560" r="300" />
          </g>
          <path d="M430 560 L421 551 L430 470 L439 551 Z" fill="#d4502a" />
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12">
          <BrandLogo onDark className="w-44" />
          <div className="max-w-md">
            <p className="font-display text-4xl leading-[1.1] font-semibold">Il porto, dalla banchina alla prima nota.</p>
            <p className="mt-4 text-[15px] leading-relaxed text-white/70">
              Posti barca, contratti, arrivi e partenze, tariffe e contabilità interna in un unico posto, dall&apos;ufficio e dal telefono.
            </p>
          </div>
          <p className="text-xs text-white/40">Omnia Marina Gestionale · app di gestione portuale</p>
        </div>
      </div>
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandLogo className="mx-auto w-28" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
