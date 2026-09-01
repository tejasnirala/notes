---
title: Testing & Debugging
author: Tejas Nirala
---

# Testing & Debugging

Testing a Next.js app is testing React plus a server. The React half is covered in [React: Testing](/reactJS/testing-react); this page is about the parts that are specific to Next.js — Server Components, Server Actions, route handlers — and about debugging code that runs in two places.

---

## 1. What to test with what

```
        ╱╲          E2E (Playwright)  ← the only way to test Server Components realistically
       ╱  ╲         critical flows: signup, checkout, the core journey
      ╱────╲
     ╱ INTEG ╲      Integration (Vitest + Testing Library)
    ╱────────╲      client components, forms, hooks, with MSW-mocked network
   ╱   UNIT   ╲     Unit (Vitest)
  ╱────────────╲    server actions, validation schemas, data helpers, pure functions
```

The distribution differs from a plain React app: async Server Components can't be unit-tested well (the tooling isn't there), so more of your confidence comes from E2E than you might be used to.

---

## 2. Unit-testing the server layer

Server Actions and query functions are ordinary async functions — test them directly.

```ts
// actions.test.ts
import { createPost } from './actions';
import { db } from '@/lib/db';
import { auth } from '@/auth';

vi.mock('@/lib/db');
vi.mock('@/auth');
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

test('rejects an unauthenticated caller', async () => {
  vi.mocked(auth).mockResolvedValue(null);

  const fd = new FormData();
  fd.append('title', 'Hello');

  await expect(createPost({}, fd)).rejects.toThrow('Unauthorized');
});

test('rejects invalid input without touching the database', async () => {
  vi.mocked(auth).mockResolvedValue({ user: { id: '1' } });

  const fd = new FormData();
  fd.append('title', '');                       // fails the schema

  const result = await createPost({}, fd);
  expect(result.errors?.title).toBeDefined();
  expect(db.post.create).not.toHaveBeenCalled();
});
```

Note what's being tested: **the security checks**, not the happy path. An action's authentication, validation and authorisation are the highest-value tests in a Next.js codebase, because each of them is a public endpoint.

```ts
// schemas are pure — test them exhaustively, it's cheap
test.each([
  ['', false], ['a', false], ['a valid title', true], ['x'.repeat(300), false],
])('title %s → %s', (title, valid) => {
  expect(PostSchema.safeParse({ title, body: 'ok' }).success).toBe(valid);
});
```

---

## 3. Testing Client Components

Standard React testing — see the [React section](/reactJS/testing-react). The Next.js-specific part is mocking the navigation hooks:

```jsx
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams('page=2'),
  useParams: () => ({ id: '1' }),
}));
```

```jsx
test('submits the form and shows an error', async () => {
  const user = userEvent.setup();
  render(<ContactForm />);

  await user.type(screen.getByLabelText(/email/i), 'not-an-email');
  await user.click(screen.getByRole('button', { name: /send/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
});
```

---

## 4. Server Components: E2E is the honest answer

```ts
// e2e/blog.spec.ts
import { test, expect } from '@playwright/test';

test('a post page renders its content server-side', async ({ page }) => {
  await page.goto('/blog/hello-world');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello World');
});

test('the content is in the initial HTML, not injected by JS', async ({ page }) => {
  // ← this is the test that actually verifies SSR
  await page.context().route('**/*.js', route => route.abort());
  await page.goto('/blog/hello-world');
  await expect(page.getByText('Hello World')).toBeVisible();
});
```

That second test is worth writing for your key pages. It's the only way to catch a regression where a component accidentally became client-only and your SEO silently broke.

```ts
// a full auth flow
test('a user can sign in and reach the dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
});
```

```ts
// playwright.config.ts — build and start the real app for the test run
export default defineConfig({
  webServer: {
    command: 'npm run build && npm start',       // NOT `next dev`
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:3000' },
});
```

Testing against `next dev` gives you different caching and different performance characteristics. Test the production build.

---

## 5. Route handlers

```ts
import { GET, POST } from './route';

test('GET returns posts', async () => {
  const response = await GET(new Request('http://localhost/api/posts'));
  expect(response.status).toBe(200);
  expect(await response.json()).toHaveLength(3);
});

test('POST rejects invalid input', async () => {
  const response = await POST(new Request('http://localhost/api/posts', {
    method: 'POST',
    body: JSON.stringify({ title: '' }),
    headers: { 'Content-Type': 'application/json' },
  }));
  expect(response.status).toBe(400);
});
```

Route handlers take a standard `Request` and return a standard `Response`, so they're straightforward to call directly — no HTTP server needed.

---

## 6. Debugging: where is this running?

```jsx
console.log('X');
// Server Component  → the TERMINAL running next dev
// Client Component  → the browser console AND the terminal (it runs once during SSR)
// Server Action     → the terminal
// Middleware        → the terminal
// Route Handler     → the terminal
```

```jsx
console.log(typeof window === 'undefined' ? 'server' : 'client');
```

Half of App Router confusion is looking for a log in the wrong console.

### Attaching a debugger

```json
// package.json
"dev:debug": "NODE_OPTIONS='--inspect' next dev"
```

```json
// .vscode/launch.json
{
  "configurations": [
    { "name": "Next: server", "type": "node-terminal", "request": "launch",
      "command": "npm run dev" },
    { "name": "Next: client", "type": "chrome", "request": "launch",
      "url": "http://localhost:3000" }
  ]
}
```

Server-side breakpoints work in Server Components, actions and route handlers — a much better experience than log-driven debugging for anything non-trivial.

---

## 7. Debugging common problems

### "Why is this route dynamic?"

```js
// next.config.mjs
export default { logging: { fetches: { fullUrl: true } } };
```

```
GET /blog/hello 200 in 15ms
  │ fetch https://api.x.com/posts (cache: SKIP, reason: no-store)
```

Then check the build output for the `ƒ` symbol, and grep for `cookies()`, `headers()` and `searchParams` in the route's component tree ([Caching](./17-caching.md)).

### "My data isn't updating"

```
1. Is there a revalidatePath/revalidateTag after the mutation?
2. Is the client Router Cache serving a stale payload? → router.refresh()
3. Are you testing in dev (which bypasses the Data Cache) or in production?
4. Is the fetch cached with a long revalidate you forgot about?
```

### "Hydration failed"

See [Hydration](./15-hydration.md). Check first for `Date`/`Math.random` during render, `window`/`localStorage` reads during render, `toLocaleString` without an explicit locale, and invalid HTML nesting.

### "Module not found: Can't resolve 'fs'"

A server-only module reached the client bundle — usually a `'use client'` file importing something that imports your database module. Add `import 'server-only'` to your data-access modules so this becomes a clear build error instead of a cryptic one.

### "Invalid hook call"

Usually two copies of React (`npm ls react`), or a hook called in a Server Component.

---

## 8. Monitoring in production

```jsx
// instrumentation.ts — runs once at server startup
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

export function onRequestError(err, request, context) {
  Sentry.captureException(err, { extra: { request, context } });
}
```

```jsx
// app/global-error.jsx
'use client';
export default function GlobalError({ error, reset }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return <html><body><h1>Something went wrong</h1>
    <button onClick={reset}>Try again</button></body></html>;
}
```

What to monitor, in priority order:

```
1. Error rate and the top errors (with the component stack)
2. Core Web Vitals from real users (LCP, INP, CLS)
3. TTFB per route
4. Server Action failure rates
5. Cache hit rates
6. Database query times
```

Remember that production hides server error messages from the client and gives you a `digest` instead — log the digest alongside the full error server-side so a user's support ticket can be traced ([Layouts & Special Files](./06-layouts-and-special-files.md)).

---

## 🧠 Rapid-fire recall

1. Why does the testing pyramid look different for a Next.js app than a plain React app?
2. What are the highest-value unit tests in a Next.js codebase, and why?
3. How do you write a test that actually proves a page is server-rendered?
4. Why should Playwright run against a production build?
5. Where does a `console.log` in a Client Component appear?
6. Give the checklist for "my data isn't updating".
7. What does `import 'server-only'` protect against?

<details>
<summary>Answers</summary>

1. Async Server Components can't be unit-tested well with current tooling, so more confidence comes from E2E tests that exercise the real server render.
2. Tests of Server Actions' authentication, validation and authorisation — each action is a public HTTP endpoint that anyone can call with arbitrary arguments, so those checks are the security boundary.
3. Block all JavaScript requests in the browser context, then load the page and assert the content is still visible — proving it came in the initial HTML rather than from hydration.
4. `next dev` compiles on demand, bypasses much of the caching layer and runs the development React build, so its behaviour and timings don't reflect production.
5. In both the browser console and the terminal — Client Components also render once on the server during SSR.
6. Check for a `revalidatePath`/`revalidateTag` after the mutation; try `router.refresh()` for a stale client Router Cache; confirm you're testing a production build rather than dev; and check whether the fetch has a long `revalidate` window.
7. It turns an accidental import of server-only code (database clients, secrets) into a Client Component from a silent runtime leak into a build-time error.

</details>
