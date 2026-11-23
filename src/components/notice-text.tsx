import { textSections } from "@/lib/templates";

/** Testo dell'informativa: il primo blocco è il titolo, i blocchi numerati hanno il titolo in grassetto e non si separano dal loro testo. */
export function NoticeText({ text }: { text: string }) {
  return (
    <>
      {textSections(text).map((section, i) =>
        i === 0 && !section.heading ? (
          <div key={i} className="mb-4 text-center">
            <h1 className="font-bold uppercase">{section.lines[0]}</h1>
            {section.lines.slice(1).map((line, j) => (
              <p key={j} className="text-muted">
                {line}
              </p>
            ))}
          </div>
        ) : (
          <section key={i} className="mt-3 break-inside-avoid">
            {section.heading && <h2 className="font-bold break-after-avoid">{section.heading}</h2>}
            {section.lines.map((line, j) => (
              <p key={j}>{line}</p>
            ))}
          </section>
        ),
      )}
    </>
  );
}
