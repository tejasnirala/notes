---
title: Images, Fonts & Scripts
author: Tejas Nirala
---

# Images, Fonts & Scripts

Three built-in optimisations that account for a large share of real-world Core Web Vitals improvements. Images are usually the biggest page weight, fonts are a classic layout-shift source, and third-party scripts are the usual reason a fast page feels slow.

---

## 1. `next/image`

```jsx
import Image from 'next/image';

<Image src="/hero.jpg" alt="A mountain at sunrise" width={1200} height={600} priority />
```

What it does for you:

| Feature | Effect |
| :-- | :-- |
| Format conversion | Serves AVIF/WebP when supported — typically 30–50% smaller than JPEG |
| Responsive sizes | Generates several widths and a `srcSet` so phones don't download desktop images |
| Lazy loading | Off-screen images aren't fetched until needed |
| Reserved space | `width`/`height` prevent layout shift (CLS) |
| Placeholders | Blur-up while loading |
| Caching | Optimised variants are cached and reused |

### Local images — dimensions are inferred

```jsx
import hero from './hero.jpg';                 // a static import

<Image src={hero} alt="…" placeholder="blur" />   // width, height and blurDataURL inferred
```

### Remote images — allow-list required

```js
// next.config.mjs
images: {
  remotePatterns: [
    { protocol: 'https', hostname: 'cdn.example.com', pathname: '/images/**' },
  ],
},
```

```jsx
<Image src="https://cdn.example.com/images/a.jpg" alt="…" width={800} height={600} />
```

The allow-list exists so an attacker can't turn your image optimiser into an open proxy for arbitrary URLs — a real SSRF and cost-abuse vector.

### `fill` — when you don't know the dimensions

```jsx
<div style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
  <Image src={url} alt="…" fill sizes="(max-width: 768px) 100vw, 50vw"
         style={{ objectFit: 'cover' }} />
</div>
```

The parent **must** be positioned (`relative`/`absolute`/`fixed`), or the image collapses.

### `sizes` — the attribute people skip, and shouldn't

```jsx
// ❌ without sizes, the browser assumes 100vw and may download a 2000px image for a thumbnail
<Image src={url} fill />

// ✅ tell the browser how wide it will actually be
<Image src={url} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
```

Read it as: below 640px the image is full width; below 1024px it's half; otherwise a third. The browser then picks the smallest adequate candidate from the `srcSet`. Getting this wrong is the most common `next/image` performance bug.

### `priority` — for the LCP image only

```jsx
<Image src="/hero.jpg" alt="…" width={1200} height={600} priority />
```

Disables lazy loading and adds a preload hint. Use it on the one above-the-fold image that is your Largest Contentful Paint — and **only** that one. Marking everything priority means nothing is prioritised.

Conversely, never put `loading="lazy"` on the LCP image; you'd be deliberately delaying your worst metric.

### Placeholders

```jsx
<Image src={hero} placeholder="blur" />                                  // local: automatic
<Image src={url} placeholder="blur" blurDataURL={base64Tiny} />          // remote: supply it
```

A ~20-byte base64 blur beats a grey box and beats a spinner.

### When *not* to use `next/image`

- SVG icons — just inline them or use `<img>`; there's nothing to optimise and rasterising is worse.
- Images from a source you can't allow-list.
- When you're on a host without the optimiser and haven't configured a custom loader — an unoptimised `<Image>` is just a heavier `<img>`.

---

## 2. `next/font`

```jsx
// app/layout.jsx
import { Inter, Roboto_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

What this does that a `<link>` to Google Fonts does not:

```
1. Downloads the font files AT BUILD TIME and self-hosts them
   → zero requests to fonts.gstatic.com at runtime
   → no third-party DNS lookup, TLS handshake, or privacy exposure
2. Generates an automatic size-adjusted fallback
   → the fallback font is metrically matched, so swapping causes NO layout shift
3. Subsets to the characters you declared
4. Preloads the files
```

Point 2 is the one that matters most for Core Web Vitals: the classic "text reflows when the webfont loads" shift disappears entirely.

### Local fonts

```jsx
import localFont from 'next/font/local';

const brand = localFont({
  src: [
    { path: './fonts/Brand-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Brand-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-brand',
  display: 'swap',
});
```

### With Tailwind

```js
// tailwind.config.js
theme: { extend: { fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] } } }
```

### `display` strategies

```
swap      show the fallback immediately, swap when loaded   ← almost always right
optional  use the webfont only if it's already cached       ← best for CWV, less brand fidelity
block     invisible text for up to 3s                       ← causes FOIT; avoid
fallback  a short block, then swap
```

Rules: declare fonts at module scope (not inside a component), keep the number of families and weights small — every weight is another file — and always list real fallbacks.

---

## 3. `next/script`

```jsx
import Script from 'next/script';

<Script src="https://analytics.example.com/s.js" strategy="afterInteractive" />
```

| Strategy | When it loads | Use for |
| :-- | :-- | :-- |
| `beforeInteractive` | before hydration, blocking | Rarely: consent managers, bot detection, polyfills |
| `afterInteractive` (default) | right after hydration | Analytics, tag managers |
| `lazyOnload` | during browser idle time | Chat widgets, social embeds, heatmaps |
| `worker` | in a web worker (experimental) | Anything that doesn't need the DOM |

```jsx
// only load the chat widget when the browser is idle
<Script src="https://widget.chat.com/w.js" strategy="lazyOnload" />

// inline scripts need an id
<Script id="gtm" strategy="afterInteractive">
  {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}`}
</Script>

// react to load/error
<Script src="…" onLoad={() => setReady(true)} onError={e => console.error(e)} />
```

### Third-party scripts are the usual culprit

```
A typical marketing page's JavaScript:
  your app                180 KB
  Google Tag Manager      120 KB   ← and everything IT loads
  a chat widget           300 KB
  an A/B testing tool      90 KB
  a heatmap recorder      150 KB
  ─────────────────────────────
  840 KB, of which 660 KB isn't yours
```

Practical approach: audit them (does anyone still read that heatmap?), give everything non-essential `lazyOnload`, load chat widgets only on interaction, and use `@next/third-parties` for the common ones:

```jsx
import { GoogleTagManager, GoogleAnalytics } from '@next/third-parties/google';
<GoogleTagManager gtmId="GTM-XXXX" />
```

These wrappers apply the recommended loading strategy for you.

---

## 4. Other static assets

```
public/
├── favicon.ico
├── robots.txt
└── logo.svg          → served at /logo.svg
```

Files in `public/` are served **as-is** with no processing and no cache-busting hash. So:

- Fine for `robots.txt`, `favicon.ico`, verification files, and rarely-changing assets.
- Bad for anything you update often — a changed `logo.svg` may be served from cache for a long time. Import such files through the bundler instead, which adds a content hash to the URL.

App Router conventions generate the right tags for you:

```
app/favicon.ico      app/icon.png       app/apple-icon.png
app/opengraph-image.png    app/twitter-image.png
```

---

## 5. Measuring

```bash
npx lighthouse https://yoursite.com --view
```

Look for: "Properly size images", "Serve images in next-gen formats", "Ensure text remains visible during webfont load", "Reduce unused JavaScript", "Avoid enormous network payloads".

```
DevTools → Network → filter Img
   Sort by size. Anything over ~200 KB deserves a look.
   Check the actual served format — is it AVIF/WebP, or still JPEG?
   Check the served width against the displayed width — a 2000px file in a 400px slot
   means your `sizes` attribute is wrong.
```

---

## 6. Mistakes

```jsx
<Image src={url} />                          // ❌ missing width/height (or fill) → CLS
<Image src={url} fill />                     // ❌ no `sizes` → downloads the largest variant
<Image ... priority />                       // ❌ on every image → prioritises nothing
<img src="/hero.jpg" />                      // ❌ no optimisation, no CLS protection
<link href="https://fonts.googleapis.com/…"> // ❌ use next/font instead
const font = Inter(...)                      // ❌ called inside a component; must be module scope
<Script src="chat.js" />                     // ❌ default strategy for a non-critical widget
```

---

## 🧠 Rapid-fire recall

1. Name four things `next/image` does that a plain `<img>` doesn't.
2. What does `sizes` control, and what goes wrong without it?
3. When should `priority` be used, and how many images per page?
4. Why must remote image hosts be allow-listed?
5. What are the two biggest wins of `next/font` over a Google Fonts `<link>`?
6. Which `display` strategy should you default to and why?
7. What's the difference between `afterInteractive` and `lazyOnload`?

<details>
<summary>Answers</summary>

1. Converts to AVIF/WebP, generates responsive variants with a `srcSet`, lazy-loads off-screen images, reserves space to prevent layout shift, and supports blur placeholders.
2. It tells the browser how wide the image will actually be displayed at each breakpoint so it can pick the smallest adequate `srcSet` candidate. Without it the browser assumes full viewport width and may download a 2000px file for a thumbnail.
3. On the single above-the-fold LCP image, and only that one — it disables lazy loading and adds a preload hint. Marking everything priority removes the prioritisation.
4. Otherwise your optimiser becomes an open proxy for arbitrary URLs — an SSRF vector and a way for others to run up your bandwidth bill.
5. It self-hosts the files at build time (removing a third-party request, DNS lookup and privacy exposure) and generates a metrically matched fallback so the font swap causes no layout shift.
6. `swap` — text is visible immediately in the fallback and upgrades when the webfont loads, and with `next/font`'s size-adjusted fallback the swap doesn't shift the layout.
7. `afterInteractive` loads immediately after hydration (analytics, tag managers); `lazyOnload` waits for browser idle time (chat widgets, embeds, heatmaps) so it never competes with your own code.

</details>
