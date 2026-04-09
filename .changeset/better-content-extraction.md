---
"sgnl-cli": minor
---

### Content extraction improvements

- **Headless browser rendering**: `analyze` and `content` commands now use Playwright (headless Chromium) for full JavaScript rendering, replacing plain HTTP fetch. Explorer commands remain on plain HTTP for speed.
- **Mobile screenshots**: `analyze --save` captures an above-the-fold mobile screenshot (`screenshot.png`) in the run directory.
- **Markdown parity**: srcset images resolve to largest variant, multi-line link escaping, GFM pipe tables with `<br>` preservation, dash bullets, `---` horizontal rules, no angle-bracket URLs.
- **Extraction options**: new `--full-content` flag disables nav/header/footer stripping; `--include-tags` and `--exclude-tags` for fine-grained CSS selector control. Available on both `content` and `analyze` commands.
- **Table rendering**: colspan headers and data rows properly wrapped as valid GFM pipe tables.
- **Bot detection mitigation**: webdriver flag disabled, automation signals suppressed.
- **Redirect chain**: only tracks main navigation hops (not sub-resources like scripts/pixels).
