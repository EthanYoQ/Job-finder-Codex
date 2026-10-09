import logoPng from "./assets/company-logos.png";
import logoWebp from "./assets/company-logos.webp";
import manifest from "./assets/company-logos";

// Content-hashed, same-origin assets. Both formats contain identical 96px tiles.
export const COMPANY_LOGO_SHEET = {
  png: logoPng, webp: logoWebp,
  columns: manifest.columns, rows: manifest.rows, tileSize: manifest.tileSize,
  gutter: manifest.gutter, stride: manifest.tileSize + 2 * manifest.gutter
};
// Stable IDs deliberately survive display-name and recruitment-scope changes.
export const COMPANY_LOGOS: Record<string, readonly [number, number]> = manifest.positions;
