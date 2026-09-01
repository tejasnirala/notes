---
title: Metadata & SEO
author: Tejas Nirala
---

# Metadata & SEO

Next.js's biggest advantage over a client-rendered SPA is that crawlers and link-preview bots receive real HTML. This page covers the Metadata API, structured data, and the technical SEO details that actually move rankings.

---

## 1. Static metadata

```jsx
// app/layout.jsx or any page.jsx
export const metadata = {
  metadataBase: new URL('https://example.com'),   // makes relative URLs resolve correctly
  title: { default: 'My Site', template: '%s | My Site' },
  description: 'A description under 160 characters that reads like a sentence.',
  openGraph: {
    title: 'My Site',
    description: '…',
    url: 'https://example.com',
    siteName: 'My Site',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '…' }],
    locale: 'en_GB',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', creator: '@handle' },
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://example.com' },
};
```

The `template` composes with child pages:

```jsx
// app/blog/page.jsx
export const metadata = { title: 'Blog' };       // → "Blog | My Site"
```

Metadata **merges** down the tree: a child inherits everything the parent set and overrides only what it declares.

`metadataBase` is easy to forget and important — without it, relative image URLs in Open Graph tags resolve incorrectly and social previews break.

---

## 2. Dynamic metadata

```jsx
// app/blog/[slug]/page.jsx
export async function generateMetadata({ params }, parent) {
  const { slug } = await params;
  const post = await getPost(slug);              // deduped with the page's own call

  if (!post) return { title: 'Not found' };

  const previousImages = (await parent).openGraph?.images ?? [];

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: 'article',
      publishedTime: post.publishedAt,
      authors: [post.author.name],
      images: [post.image, ...previousImages],
    },
    alternates: { canonical: `https://example.com/blog/${slug}` },
  };
}
```

Two performance notes:

- `generateMetadata` **blocks the shell**, so a slow query here delays the whole response. Keep it fast.
- Wrap your data function in React's `cache()` so the metadata and the page body share one query instead of issuing two ([Data Fetching](./16-data-fetching.md)).

---

## 3. Open Graph images

```jsx
// app/blog/[slug]/opengraph-image.tsx
import { ImageResponse } from 'next/og';

export const alt = 'Blog post';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }) {
  const post = await getPost(params.slug);

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', padding: 80, background: '#0b0b0f', color: '#fff',
      }}>
        <div style={{ fontSize: 64, fontWeight: 700 }}>{post.title}</div>
        <div style={{ fontSize: 28, opacity: 0.7, marginTop: 24 }}>{post.author.name}</div>
      </div>
    ),
    size
  );
}
```

Generated per post, at request time, cached. Constraints: it uses Satori, which supports a **subset of CSS** — flexbox works, grid doesn't; no external CSS; fonts must be supplied explicitly for non-default typefaces. Every element needs an explicit `display` if it has multiple children.

Worth doing: a good OG image measurably increases click-through on shared links, and it's the one asset most sites never bother generating.

---

## 4. Structured data (JSON-LD)

This is what produces rich results — star ratings, recipe cards, FAQ accordions, breadcrumbs in search listings.

```jsx
export default async function Post({ params }) {
  const post = await getPost((await params).slug);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    image: post.image,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: { '@type': 'Person', name: post.author.name, url: post.author.url },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article>…</article>
    </>
  );
}
```

Common types: `Article`/`BlogPosting`, `Product` (with `offers` and `aggregateRating`), `BreadcrumbList`, `FAQPage`, `Organization`, `LocalBusiness`, `Event`, `Recipe`.

Validate with Google's Rich Results Test before shipping — malformed JSON-LD is silently ignored, so it either works or does nothing with no feedback.

---

## 5. Sitemap and robots

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getPosts();
  return [
    { url: 'https://example.com', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: 'https://example.com/blog', lastModified: new Date(), priority: 0.8 },
    ...posts.map(p => ({
      url: `https://example.com/blog/${p.slug}`,
      lastModified: p.updatedAt,
      priority: 0.6,
    })),
  ];
}
```

```ts
// app/robots.ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin/', '/draft/'] }],
    sitemap: 'https://example.com/sitemap.xml',
  };
}
```

For very large sites, generate sitemap **index** files with `generateSitemaps` — a single sitemap is capped at 50,000 URLs.

---

## 6. Canonical URLs

Duplicate content splits ranking signals across URLs. Declare the canonical one:

```jsx
export const metadata = {
  alternates: {
    canonical: 'https://example.com/products/widget',
    languages: { 'en-GB': '/en-gb/products/widget', 'de-DE': '/de/products/widget' },
  },
};
```

Common duplicate sources: `?utm_source=…` tracking parameters, `/page` vs `/page/`, `www` vs bare domain, `http` vs `https`, and filter/sort permutations. Pick one form and canonicalise to it; enforce the host and protocol choice with a redirect.

---

## 7. Technical SEO checklist

```
□ Every page has a unique <title> (50–60 chars) and description (under 160)
□ One <h1> per page, and a sensible heading hierarchy
□ Canonical URL declared on every indexable page
□ sitemap.xml and robots.txt present and correct
□ Structured data validated with the Rich Results Test
□ Open Graph and Twitter tags with a 1200×630 image
□ Images have meaningful alt text
□ Internal links use <Link> (crawlable <a> elements)
□ Real 404 status codes, not soft 404s
□ Core Web Vitals in the green (they're a ranking signal)
□ Mobile-friendly (the mobile version is what's indexed)
□ HTTPS everywhere, one canonical host
□ Content is in the server HTML, not injected only by client JS
```

That last point is why the framework matters. Googlebot does render JavaScript, but it does so in a second pass that can be delayed, and most other crawlers and every link-preview bot (Slack, WhatsApp, Twitter, LinkedIn) do not execute JS at all.

---

## 8. Streaming and SEO

Streamed content is indexed — Googlebot waits for the response to complete. But:

- Keep the `<h1>`, meta tags, canonical link and structured data **outside** Suspense boundaries so they're in the first chunk.
- `generateMetadata` blocks the shell, so an unoptimised query there hurts TTFB for every crawl and every user.

---

## 9. Verifying

```bash
# what does the crawler actually receive?
curl -s https://example.com/blog/post | grep -o '<title>.*</title>'
curl -s https://example.com/blog/post | grep 'og:'
```

```
Google Search Console → URL Inspection → View crawled page
Rich Results Test     → structured data
Google PageSpeed      → Core Web Vitals, field data
opengraph.xyz         → social previews across platforms
```

`curl` is the honest test: it shows exactly what a non-JS crawler sees. If your content isn't in that output, it isn't in your server HTML.

---

## 🧠 Rapid-fire recall

1. How does the metadata `template` work, and how does metadata compose down the tree?
2. What does `metadataBase` fix?
3. What are the two performance considerations for `generateMetadata`?
4. What is JSON-LD for, and how do you know it's correct?
5. Why do canonical URLs matter, and name three sources of duplicates.
6. Why does server-rendered content matter when Googlebot executes JavaScript?
7. What must stay outside Suspense boundaries, and why?

<details>
<summary>Answers</summary>

1. A parent sets `title: { template: '%s | Site' }` and a child sets `title: 'Blog'`, producing "Blog | Site". Metadata merges down the tree — children inherit everything and override only what they declare.
2. It resolves relative URLs (especially Open Graph images) to absolute ones. Without it, social previews break because crawlers can't resolve a relative path.
3. It blocks the response shell, so a slow query there delays TTFB for everyone; and it should share the page's data via React's `cache()` rather than issuing a duplicate query.
4. Structured data that produces rich search results — ratings, FAQs, breadcrumbs, recipe cards. Validate it with Google's Rich Results Test, because malformed JSON-LD is silently ignored.
5. Duplicates split ranking signals across URLs. Sources: tracking query parameters, trailing-slash variants, `www` vs bare domain, `http` vs `https`, and filter/sort permutations.
6. Googlebot renders JS in a delayed second pass, and most other crawlers plus every social link-preview bot don't execute JS at all — so a client-only render means no preview and slower, less reliable indexing.
7. The `<h1>`, meta tags, canonical link and structured data — they need to be in the first streamed chunk so crawlers and preview bots that read only the initial HTML find them.

</details>
