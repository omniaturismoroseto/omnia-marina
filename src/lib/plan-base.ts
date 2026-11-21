// La base disegnata dello schema ricalca la foto aerea: stessa inquadratura, a qualunque risoluzione.

/** Vero se la base ha le stesse proporzioni della foto (scarto massimo 1%), così i posti combaciano. */
export function baseMatchesPhoto(base: { width: number; height: number }, photo: { width: number; height: number }): boolean {
  const a = base.width / base.height;
  const b = photo.width / photo.height;
  return Math.abs(a - b) / b <= 0.01;
}
