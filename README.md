# Handoff: Alternative Dream – Glamping Tent Catalog

## Task for Claude Code
Publish this catalog as a live website. **Do not rebuild it** — `index.html` is final, self-contained (all images, fonts, CSS inlined), and ships as-is.

1. Push the contents of this folder to `https://github.com/femmeacademy1-code/alternative` on branch `main` (the repo is currently empty):
   ```
   git init && git branch -M main
   git remote add origin https://github.com/femmeacademy1-code/alternative.git
   git add . && git commit -m "Alternative Dream catalog"
   git push -u origin main
   ```
2. Enable GitHub Pages: the included `.github/workflows/pages.yml` deploys on every push to `main`. In the repo go to **Settings → Pages → Source: GitHub Actions** (or run `gh api -X POST repos/femmeacademy1-code/alternative/pages -f build_type=workflow`).
3. The repo must be **public** for Pages on a free account.
4. Live URL: `https://femmeacademy1-code.github.io/alternative/`

## About the page
- Hebrew, RTL, mobile-first catalog for Alternative Dream (altnativedream.com).
- Sections: hero → why us → Lotus models → Bell models → what's included → delivery CTA → contact footer.
- Size cards per model (swipe on mobile, grid on desktop), photo gallery per model, VAT toggle (18%), sticky WhatsApp button (wa.me/972515490099).
- Fonts: Assistant (body), Ploni (headings — commercial, falls back to Assistant unless installed/licensed).
- Colors: green `#52725a`, brown `#72544b`, orange `#c46a2f`, background `#f3ece2`.

## Notes
- Lotus 9M specs (height 450cm, weight 100kg, capacity) are estimates — confirm with supplier.
- To update later: edit in Claude Design, re-export `index.html`, replace and push.

## Files
- `index.html` — the full site (standalone)
- `.github/workflows/pages.yml` — GitHub Pages deploy workflow
