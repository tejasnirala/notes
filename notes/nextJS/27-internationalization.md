---
title: Internationalization
author: Tejas Nirala
---

# Internationalization

The App Router has no built-in i18n routing (the Pages Router did), so you build it from a dynamic segment plus middleware. That sounds worse than it is — the resulting setup is more flexible, and the pieces are small.

---

## 1. The URL strategy

```
Sub-path:     example.com/en/about   example.com/de/about    ← recommended
Sub-domain:   en.example.com         de.example.com
Domain:       example.com            example.de
```

Sub-path routing is the default recommendation: one deployment, one certificate, easy for search engines to associate, and trivial to add a language to.

```
app/
└── [locale]/
    ├── layout.tsx
    ├── page.tsx              → /en, /de
    └── about/page.tsx        → /en/about, /de/about
```

---

## 2. Locale detection in middleware

```ts
// middleware.ts
import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';

const locales = ['en', 'de', 'fr'];
const defaultLocale = 'en';

function getLocale(request: NextRequest) {
  // 1. an explicit choice, remembered
  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
  if (cookieLocale && locales.includes(cookieLocale)) return cookieLocale;

  // 2. the Accept-Language header
  const headers = { 'accept-language': request.headers.get('accept-language') ?? '' };
  const languages = new Negotiator({ headers }).languages();
  return match(languages, locales, defaultLocale);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasLocale = locales.some(l => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return;

  const locale = getLocale(request);
  return NextResponse.redirect(new URL(`/${locale}${pathname}`, request.url));
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};
```

```
Request /about with Accept-Language: de-DE
  → no locale in the path
  → detect 'de'
  → 308 redirect to /de/about
```

Note the cookie takes priority over the header: once a user explicitly picks a language, honour it even if their browser says otherwise. That's a real usability point — plenty of people run an English-language OS while wanting a different content language.

---

## 3. Translations

```json
// messages/en.json
{
  "nav": { "home": "Home", "about": "About" },
  "home": {
    "title": "Welcome",
    "greeting": "Hello, {name}!",
    "items": "{count, plural, =0 {No items} one {# item} other {# items}}"
  }
}
```

```json
// messages/de.json
{
  "nav": { "home": "Startseite", "about": "Über uns" },
  "home": {
    "title": "Willkommen",
    "greeting": "Hallo, {name}!",
    "items": "{count, plural, =0 {Keine Artikel} one {# Artikel} other {# Artikel}}"
  }
}
```

That plural syntax is **ICU MessageFormat**, and it's the reason to use a real i18n library rather than a lookup object. Languages have between one and six plural forms — Arabic has six, Polish has four, Japanese has one. `count === 1 ? 'item' : 'items'` is an English-only assumption baked into your code.

---

## 4. Using `next-intl`

```ts
// i18n/request.ts
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? 'en';
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
```

```jsx
// app/[locale]/layout.jsx
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

```jsx
// a Server Component — no client JS for the translations
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('home');
  return <h1>{t('title')}</h1>;
}
```

```jsx
// a Client Component
'use client';
import { useTranslations } from 'next-intl';

export function Greeting({ name, count }) {
  const t = useTranslations('home');
  return <>
    <p>{t('greeting', { name })}</p>
    <p>{t('items', { count })}</p>
  </>;
}
```

⚠️ `NextIntlClientProvider` sends the messages it wraps to the client. Pass only the namespaces your Client Components actually need, not the whole file — otherwise every translation string in your app is in the bundle.

---

## 5. Static generation for every locale

```jsx
// app/[locale]/page.jsx
export function generateStaticParams() {
  return ['en', 'de', 'fr'].map(locale => ({ locale }));
}
```

Combined with a nested dynamic route:

```jsx
// app/[locale]/blog/[slug]/page.jsx
export async function generateStaticParams() {
  const posts = await getPosts();
  return locales.flatMap(locale => posts.map(p => ({ locale, slug: p.slug })));
}
```

Three locales × two hundred posts = six hundred static pages, all served from a CDN.

---

## 6. SEO for multilingual sites

```jsx
export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });

  return {
    title: t('title'),
    alternates: {
      canonical: `https://example.com/${locale}`,
      languages: {
        'en': 'https://example.com/en',
        'de': 'https://example.com/de',
        'x-default': 'https://example.com/en',
      },
    },
  };
}
```

Three requirements search engines care about:

1. **`<html lang>`** must reflect the actual content language — it also drives screen-reader pronunciation.
2. **`hreflang` alternates** on every page, so each language version is understood as a translation rather than duplicate content. Include `x-default` for the fallback.
3. **A real URL per language.** A cookie-switched single URL cannot be indexed per language.

---

## 7. Formatting

```jsx
import { useFormatter } from 'next-intl';

function Prices({ amount, date }) {
  const format = useFormatter();
  return <>
    <p>{format.number(amount, { style: 'currency', currency: 'EUR' })}</p>
    <p>{format.dateTime(date, { dateStyle: 'long' })}</p>
    <p>{format.relativeTime(date)}</p>
  </>;
}
```

Or the platform primitive, which costs nothing:

```jsx
new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(1234.5);
// "1.234,50 €"
new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(date);
new Intl.RelativeTimeFormat('de').format(-3, 'day');       // "vor 3 Tagen"
new Intl.ListFormat('de').format(['a', 'b', 'c']);         // "a, b und c"
```

`Intl` is built into every browser and Node. Always pass an explicit locale — and note that formatting on the client with the *user's* locale while the server used a different one is a classic hydration mismatch ([Hydration](./15-hydration.md)). Format on the server with the route's locale.

---

## 8. A language switcher

```jsx
'use client';
import { usePathname, useRouter } from 'next/navigation';

export function LocaleSwitcher({ current, locales }) {
  const pathname = usePathname();          // '/de/about'
  const router = useRouter();

  function change(next) {
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`;
    const rest = pathname.replace(/^\/[a-z]{2}/, '');
    router.push(`/${next}${rest}`);
  }

  return (
    <select value={current} onChange={e => change(e.target.value)} aria-label="Language">
      {locales.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
    </select>
  );
}
```

Setting the cookie is what makes the choice stick across sessions and stops the middleware from redirecting them back.

---

## 9. RTL

```jsx
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

<html lang={locale} dir={RTL.has(locale) ? 'rtl' : 'ltr'}>
```

```css
/* use logical properties — they flip automatically with `dir` */
.card { margin-inline-start: 1rem; padding-inline: 1rem; border-inline-start: 2px solid; }

/* not physical ones */
.card { margin-left: 1rem; }        /* ❌ wrong side in RTL */
```

Tailwind supports these (`ms-4`, `me-4`, `ps-4`, `pe-4`, `start-0`, `end-0`) — using them from the start costs nothing and makes RTL support a one-line change later.

---

## 10. Practical notes

```
□ Never concatenate translated fragments — word order differs between languages
  ❌ t('you have') + ' ' + count + ' ' + t('items')
  ✅ t('itemCount', { count })     with ICU plurals
□ Leave room in layouts: German is often 30% longer than English
□ Don't put text in images — it can't be translated
□ Translate metadata too (title, description, OG tags)
□ Give translators context: key names like `button.submit`, not `text1`
□ Keep a single source-of-truth locale file and detect missing keys in CI
□ Lazy-load namespaces so a page only ships the strings it uses
```

---

## 🧠 Rapid-fire recall

1. Why does the App Router need middleware for i18n when the Pages Router didn't?
2. What order should locale detection use, and why does the cookie come first?
3. Why is ICU MessageFormat necessary rather than a ternary for plurals?
4. What must you be careful about with `NextIntlClientProvider`?
5. Name the three SEO requirements for a multilingual site.
6. Why format dates and numbers on the server rather than the client?
7. What are CSS logical properties and why do they matter here?

<details>
<summary>Answers</summary>

1. The App Router removed the Pages Router's built-in i18n routing config, so locale detection and redirection are built from a `[locale]` dynamic segment plus middleware — more code, but far more flexible.
2. An explicit user choice (cookie) first, then the `Accept-Language` header, then a default. A user who has picked a language should not be redirected away from it by their browser settings.
3. Languages have between one and six plural forms; `count === 1 ? 'item' : 'items'` encodes an English-only rule that produces wrong grammar in Polish, Arabic, Russian and others.
4. It serialises the messages it wraps to the client, so passing the entire translation file ships every string in every namespace to the browser. Pass only the namespaces the client components need.
5. `<html lang>` matching the content, `hreflang` alternates (including `x-default`) on every page, and a distinct real URL per language.
6. Formatting with the user's locale on the client while the server used a different one produces a hydration mismatch. Format on the server using the route's locale so both renders agree.
7. `margin-inline-start`, `padding-inline` and similar properties resolve relative to the writing direction, so they flip automatically for RTL languages when `dir="rtl"` is set — no separate stylesheet.

</details>
