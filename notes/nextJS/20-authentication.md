---
title: Authentication & Authorization
author: Tejas Nirala
---

# Authentication & Authorization

Auth in the App Router spans middleware, Server Components, Server Actions and Route Handlers — and the mistake almost everyone makes is checking it in exactly one of those places.

---

## 1. Authentication vs authorization

```
AUTHENTICATION:  who are you?          → sessions, tokens, login
AUTHORIZATION:   what may you do?      → roles, ownership, permissions
```

Conflating them produces the classic bug: a logged-in user editing someone else's resource. Authentication passed; authorization was never checked.

---

## 2. The layered model

There is no single place to "put auth". Each layer does a different job.

```
┌───────────────────────────────────────────────────────────────────────┐
│ 1. MIDDLEWARE           optimistic check — does a session cookie exist?│
│    Purpose: redirect fast. NOT a security boundary.                    │
├───────────────────────────────────────────────────────────────────────┤
│ 2. LAYOUT / PAGE        verify the session properly; decide what to show│
│    Purpose: correct UI. Still not sufficient on its own.               │
├───────────────────────────────────────────────────────────────────────┤
│ 3. DATA ACCESS LAYER    ◀── THE ACTUAL SECURITY BOUNDARY               │
│    Every query and mutation checks who is asking and what they may do. │
├───────────────────────────────────────────────────────────────────────┤
│ 4. SERVER ACTIONS /     each is a public endpoint: authenticate,       │
│    ROUTE HANDLERS       validate, authorize — every time.              │
└───────────────────────────────────────────────────────────────────────┘
```

**Why layer 3 is the real boundary:** a layout check protects the *page*, but a Server Action or Route Handler can be called directly, bypassing every page. If the check lives next to the data, it can't be routed around.

---

## 3. Sessions: cookies vs JWTs

| | Database session | JWT |
| :-- | :-- | :-- |
| Revocation | ✅ delete the row | ❌ valid until expiry (needs a denylist) |
| Verify cost | a DB lookup per request | a local signature check |
| Size | a small opaque id | the whole payload in every request |
| Edge/middleware friendly | ❌ needs a DB | ✅ `jose` verifies locally |
| Stale claims | ✅ always current | ⚠️ a role change isn't reflected until refresh |

Common compromise: a short-lived JWT (15 minutes) for fast checks, plus a database-backed refresh token that can be revoked.

```ts
// cookie settings that matter
cookies().set('session', token, {
  httpOnly: true,        // JavaScript can't read it → XSS can't steal it
  secure: true,          // HTTPS only
  sameSite: 'lax',       // CSRF mitigation; 'strict' breaks OAuth redirects
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
});
```

`httpOnly` is non-negotiable. A token in `localStorage` is readable by any injected script — one XSS and every session is compromised.

---

## 4. Use a library

Rolling your own auth means owning password hashing, timing-safe comparison, session rotation, CSRF, OAuth state parameters, PKCE, email verification and account linking. Every one of those has a subtle failure mode.

| Library | Model |
| :-- | :-- |
| **Auth.js (NextAuth v5)** | Open source, self-hosted, many providers |
| **Clerk** | Hosted; components and user management included |
| **Lucia / Better Auth** | Lower level, you own the database |
| **Supabase Auth / Firebase** | Bundled with the backend |
| **WorkOS / Auth0** | Enterprise SSO, SAML, SCIM |

```ts
// auth.ts — Auth.js v5
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  callbacks: {
    session({ session, token }) {
      session.user.id = token.sub!;
      return session;
    },
  },
});
```

```ts
// app/api/auth/[...nextauth]/route.ts
export const { GET, POST } = handlers;
```

---

## 5. Checking auth at each layer

### Middleware — optimistic only

```ts
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has('session');
  if (!hasSession) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!login|register|api/auth|_next).*)'] };
```

Presence, not validity. A full verification here costs a database round trip on every request, and middleware can be bypassed in some configurations ([Middleware](./10-middleware.md)).

### Layout / page — verify properly

```jsx
// app/dashboard/layout.jsx
import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({ children }) {
  const session = await auth();
  if (!session) redirect('/login');
  return <div><Sidebar user={session.user} />{children}</div>;
}
```

⚠️ A layout check does **not** protect the pages beneath it from direct data access, and layouts don't re-render on every navigation within their segment. Treat this as UI logic, not as the gate.

### The Data Access Layer — the real gate

```ts
// lib/dal.ts
import 'server-only';
import { cache } from 'react';
import { auth } from '@/auth';

export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user) return null;
  return db.user.findUnique({ where: { id: session.user.id } });
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function getPost(id: string) {
  const user = await requireUser();
  const post = await db.post.findUnique({ where: { id } });
  if (!post) notFound();
  if (post.authorId !== user.id && !post.published) notFound();   // ← authorization
  return post;
}
```

Every caller of `getPost` is now safe by construction — a page, an action, a route handler, a future feature nobody's written yet. `cache()` means the session lookup happens once per request despite being called everywhere.

### Actions and handlers

```ts
'use server';
export async function deletePost(id: string) {
  const user = await requireUser();                     // authenticate
  const { id: safeId } = z.object({ id: z.string().uuid() }).parse({ id });  // validate
  const post = await db.post.findUnique({ where: { id: safeId } });
  if (post?.authorId !== user.id) throw new Error('Forbidden');  // authorize
  await db.post.delete({ where: { id: safeId } });
  revalidatePath('/posts');
}
```

---

## 6. Authorization patterns

```ts
// role-based
if (user.role !== 'admin') throw new Error('Forbidden');

// ownership
if (resource.ownerId !== user.id) notFound();     // notFound() leaks less than 403

// permission-based — scales better than roles
const can = (user, action, resource) => user.permissions.includes(`${resource}:${action}`);
if (!can(user, 'delete', 'post')) throw new Error('Forbidden');

// row-level: scope the QUERY, don't filter after
const posts = await db.post.findMany({ where: { authorId: user.id } });   // ✅
const posts = (await db.post.findMany()).filter(p => p.authorId === user.id);  // ❌ leaks
```

Two things worth internalising:

- **Prefer `notFound()` to a 403** for resources the user shouldn't know exist. A 403 confirms the resource exists — an information leak in things like `/users/12345/private-note`.
- **Filter in the query, not after it.** Fetching everything and filtering in JavaScript means the data was in memory (and possibly in a log, a cache, or an RSC payload) before you dropped it.

---

## 7. Conditional UI — presentation only

```jsx
export default async function Page() {
  const user = await getCurrentUser();
  return (
    <>
      <Content />
      {user?.role === 'admin' && <AdminPanel />}      {/* UI only */}
    </>
  );
}
```

Hiding a button hides a button. The action it called is still a public endpoint. Every conditional UI check must have a matching server-side check somewhere in the data layer.

---

## 8. CSRF

Server Actions have built-in protection: Next.js verifies the `Origin` header against the `Host` and rejects mismatches, and actions are POST-only with an unguessable action id.

For your own Route Handlers you're responsible:

```ts
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin !== process.env.NEXT_PUBLIC_APP_URL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}
```

`sameSite: 'lax'` on the session cookie blocks the classic cross-site form POST, which covers most of it. `strict` is stronger but breaks OAuth callbacks and links from external sites.

---

## 9. Login and logout

```jsx
// app/login/page.jsx
import { signIn } from '@/auth';

export default function Login({ searchParams }) {
  return (
    <form action={async (formData) => {
      'use server';
      await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirectTo: searchParams.next ?? '/dashboard',
      });
    }}>
      <input name="email" type="email" autoComplete="email" required />
      <input name="password" type="password" autoComplete="current-password" required />
      <button>Sign in</button>
    </form>
  );
}
```

```jsx
// logout
<form action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
  <button>Sign out</button>
</form>
```

Additional essentials: rate-limit the login endpoint (credential stuffing is automated and constant), hash passwords with bcrypt/argon2 (never SHA-256), and return the **same generic error** for "no such user" and "wrong password" so you don't confirm which emails are registered.

---

## 10. Checklist

```
□ Session cookies: httpOnly, secure, sameSite
□ Auth checked in the DATA layer, not only in layouts
□ Every Server Action authenticates, validates and authorizes
□ Every Route Handler does the same
□ Ownership checks on every resource-scoped query
□ Queries scoped by user, not filtered afterwards
□ notFound() rather than 403 for resources whose existence is sensitive
□ Login is rate-limited; passwords are hashed with bcrypt/argon2
□ Generic error messages on login
□ Sessions rotate on privilege change; logout invalidates server-side
□ No tokens in localStorage
□ Middleware treated as UX, not security
```

---

## 🧠 Rapid-fire recall

1. What's the difference between authentication and authorization, and what bug follows from conflating them?
2. Why is middleware not a security boundary?
3. Why is the Data Access Layer the right place for the real check?
4. Compare database sessions and JWTs on revocation and edge-friendliness.
5. Why must session tokens never live in `localStorage`?
6. When should you return `notFound()` instead of a 403?
7. Why filter in the query rather than after it?

<details>
<summary>Answers</summary>

1. Authentication establishes identity; authorization establishes permission. Conflating them yields a logged-in user successfully acting on another user's resource.
2. It may be skipped by some deployment configurations, a matcher mistake silently leaves routes open, and it can only afford a cheap presence check rather than real verification.
3. Because every caller — pages, actions, route handlers, future code — goes through it, so the check cannot be routed around. Page-level checks protect only that page.
4. Database sessions can be revoked instantly by deleting the row but need a lookup per request, which doesn't work in edge middleware. JWTs verify locally and are edge-friendly, but stay valid until expiry unless you maintain a denylist.
5. Any injected script can read `localStorage`, so a single XSS steals every session. An `httpOnly` cookie is invisible to JavaScript.
6. When the existence of the resource is itself sensitive — a 403 confirms the record exists and can be enumerated.
7. Filtering afterwards means the data was fetched into memory (and possibly logged, cached or serialised) before being discarded. Scoping the query means it never leaves the database.

</details>
