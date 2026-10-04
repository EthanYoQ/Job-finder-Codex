# Company logo correctness and delivery

## Verified baseline

- Production base: `ea266d423df750bd19ac1f38af4f4f5718756767`
- The supplied screenshot and production browser both show the company plate.
- There are 40 checked-in original PNG files, each 96×96, totalling 301,840 bytes.
- The actual 41-company plate uses 34 original files, totalling 251,643 bytes. Seven entries fall back to a Chinese initial because no exact display-name key exists.
- J&J already has a correct red mark, but its current full company name differs from the old map key. Fosun's supplied tile is only a blurry F.
- The old images use async decoding and default eager loading, not lazy loading. CSS supplies a fixed circle and 74% inner image size.
- A public HTTP read of the 3,808-byte AbbVie PNG on 2026-10-03 returned `200`, `image/png`, an ETag and Last-Modified, but no Cache-Control. That single request took 5.47s, including 5.39s before first byte. This is an HTTP probe, not a browser benchmark and does not prove that all users see that delay.
- There are 110 font files, with Unicode subsetting and font-display: swap. The inventory alone does not mean the browser downloads every font; no change is made to typography.

## Minimal changes

1. Match the confirmed 41 companies by stable ID. The same CompanyLogo component serves the plate, hover readout, job groups and official directory.
2. Replace the Fosun F and supply actual official Servier, Hansoh, Shanghai Pharma, Aspen, Grand Pharma and United Laboratories marks. Keep the existing correct J&J asset. Exact official sources and hashes are in the adjacent JSON provenance file.
3. Pack the 41 96px tiles into one same-origin, content-hashed WebP, with a matching PNG picture fallback. This removes per-company request overhead without reducing existing source resolution or changing the circle design.
4. Set explicit dimensions and eager loading, and prioritize the first plate image. All images reference the same resource. No pre-consent job or coverage request is introduced.
5. If the resource really fails, show a neutral building icon instead of a misleading Chinese initial. A company change resets the failed state.

## Resource comparison

- Current production: 34 image URLs / 251,643 bytes, plus seven missing marks
- Corrected 41 logos as separate PNGs: 41 URLs / 281,801 bytes
- New WebP: 1 URL / 192,258 bytes (23.6% below production's 34 images, or 31.8% below the corrected 41 individual files)
- Compatibility PNG: 1 URL / 275,256 bytes; browsers choose a single supported picture source
- Lossless decode verification: zero different visible pixels when composited on the actual white background

The source tiles, source manifest, generated assets and rebuild script are committed. Regeneration uses Python/Pillow only as a development tool; the normal Node build requires no new dependency. Vite content hashes provide cache invalidation. The publisher should serve the content-hashed sprite with its correct MIME type and long immutable caching.

## Checks at candidate preparation

- Build: passed
- Frontend TypeScript (`tsconfig.redesign-check.json`): passed
- Frontend tests: 48 passed, including consent lock, filters, retry, view navigation and five logo regression cases
- Repository-wide TypeScript: process killed (exit 137); not reported as passed
- First same-origin preview: 41/41 plate, 36/36 job rows and 41/41 directory rows loaded. All stable IDs match tile coordinates; desktop and 426px mobile screenshots verified
- A close directory screenshot review exposed a fractional-scaling border line from an adjacent tile. The follow-up adds a 2px transparent guard around each unchanged 96px tile, with explicit guard-pixel assertions. New WebP grows only 870 bytes
- WebP MIME GET/HEAD regression: passed
- Final gutter preview: pending publisher preview
- Repository-wide tests were stopped to conserve shared resources; the incomplete run included an unrelated-area CSPC stale-state assertion failure and is not reported as passing

No data acquisition, filters, source scope, consent semantics, external CDN or security setting changes. The server MIME table gains image/webp support only.
