import { describe, expect, it } from "vitest";
import { checkLogo, LOGO_MAX_BYTES, portLogo } from "../src/lib/logo";

// Intestazione PNG minima: firma, poi il blocco IHDR con larghezza e altezza (bastano per riconoscere il file).
function png(width: number, height: number, extra = 0): Uint8Array {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

// JPEG minimo: SOI, poi un marcatore SOF0 con altezza e larghezza.
function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0, 0, 0, 0, 0, 0]);
  new DataView(bytes.buffer).setUint16(7, height);
  new DataView(bytes.buffer).setUint16(9, width);
  return bytes;
}

describe("logo della società di gestione", () => {
  it("accetta PNG e JPEG e ne legge le misure", () => {
    expect(checkLogo(png(600, 200))).toEqual({ ok: true, info: { mime: "image/png", width: 600, height: 200 } });
    expect(checkLogo(jpeg(400, 400))).toEqual({ ok: true, info: { mime: "image/jpeg", width: 400, height: 400 } });
  });

  it("rifiuta SVG e file che non sono immagini, qualunque nome abbiano", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(checkLogo(svg)).toMatchObject({ ok: false, message: expect.stringMatching(/PNG o JPEG/) });
    expect(checkLogo(new TextEncoder().encode("%PDF-1.7"))).toMatchObject({ ok: false });
    expect(checkLogo(new Uint8Array())).toMatchObject({ ok: false, message: "Nessun file ricevuto." });
  });

  it("rifiuta loghi troppo piccoli, troppo grandi o troppo pesanti", () => {
    expect(checkLogo(png(500, 20))).toMatchObject({ ok: false, message: expect.stringMatching(/troppo piccolo/) });
    expect(checkLogo(png(4000, 800))).toMatchObject({ ok: false, message: expect.stringMatching(/troppo grande/) });
    expect(checkLogo(png(600, 200, LOGO_MAX_BYTES))).toMatchObject({ ok: false, message: expect.stringMatching(/troppo pesante/) });
  });

  it("senza misure salvate il porto non ha logo", () => {
    expect(portLogo({ logoVersion: 3, logoWidth: null, logoHeight: null })).toBeNull();
    expect(portLogo({ logoVersion: 3, logoWidth: 600, logoHeight: 200 })).toEqual({ version: 3, width: 600, height: 200 });
  });
});
