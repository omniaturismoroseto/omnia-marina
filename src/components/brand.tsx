// Marchio: rosa dei venti essenziale, con la punta del nord color boa.
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
      <path d="M16 16 L13.2 13.2 L16 2.5 Z" fill="#d4502a" />
      <path d="M16 16 L18.8 13.2 L16 2.5 Z" fill="#e8734f" />
      <path d="M16 16 L18.8 18.8 L16 29.5 Z M16 16 L13.2 18.8 L16 29.5 Z" fill="currentColor" fillOpacity="0.85" />
      <path d="M16 16 L18.8 13.2 L29.5 16 Z M16 16 L18.8 18.8 L29.5 16 Z" fill="currentColor" fillOpacity="0.6" />
      <path d="M16 16 L13.2 13.2 L2.5 16 Z M16 16 L13.2 18.8 L2.5 16 Z" fill="currentColor" fillOpacity="0.6" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <BrandMark />
      <span className="font-display text-xl font-semibold">Omnia Marina</span>
    </span>
  );
}
