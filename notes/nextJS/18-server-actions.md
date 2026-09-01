---
title: Server Actions
author: Tejas Nirala
---

# Server Actions

Functions that run on the server but can be called from client code as if they were local. They replace the "write an API route, fetch it, handle the response" cycle for your own app's mutations — and they carry security implications you must understand before using them.

---

## 1. The basics

```jsx
// app/actions.js
'use server';                                  // marks EVERY export as a server action

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';

export async function createPost(formData) {
  const title = formData.get('title');
  await db.post.create({ data: { title } });
  revalidatePath('/posts');
}
```

```jsx
// app/new/page.jsx — a Server Component, no 'use client' anywhere
import { createPost } from '../actions';

export default function NewPost() {
  return (
    <form action={createPost}>
      <input name="title" required />
      <button type="submit">Create</button>
    </form>
  );
}
```

That form works **with JavaScript disabled**. Next.js renders a real `<form method="POST">` pointing at an endpoint it generates; when JS loads, it upgrades to a fetch-based submission that avoids a full page reload. Progressive enhancement, by default.

### Inline actions

```jsx
export default function Page() {
  async function create(formData) {
    'use server';                              // per-function directive
    await db.post.create({ data: { title: formData.get('title') } });
    revalidatePath('/posts');
  }
  return <form action={create}><input name="title" /><button>Go</button></form>;
}
```

Inline actions close over their scope, and those closed-over values are **encrypted and sent to the client**, then sent back on invocation. Convenient, but keep the closure small and never close over a secret.

---

## 2. What happens when you call one

```
CLIENT
  form submitted (or action called from a client component)
    │
    ▼  POST to the current URL, with a Next-Action header carrying an action ID
SERVER
  Next.js looks up the action by ID
  runs it — with full database access, secrets, cookies
  runs any revalidatePath / revalidateTag
    │
    ▼  the response carries the return value AND the updated RSC payload
CLIENT
  the return value resolves at the call site
  the re-rendered server output is merged into the existing tree
  → the UI updates without a page reload, and client state is preserved
```

That last line is the payoff: one round trip performs the mutation *and* refreshes the affected server-rendered UI, with no separate refetch.

---

## 3. Calling actions from Client Components

```jsx
'use client';
import { createPost } from './actions';
import { useActionState } from 'react';

export function Form() {
  const [state, formAction, isPending] = useActionState(createPost, { message: '' });

  return (
    <form action={formAction}>
      <input name="title" />
      <button disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  );
}
```

```jsx
// the action's signature gains a previous-state argument
'use server';
export async function createPost(prevState, formData) {
  const parsed = Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { message: 'Invalid input', errors: parsed.error.flatten().fieldErrors };
  }
  await db.post.create({ data: parsed.data });
  revalidatePath('/posts');
  return { message: 'Created' };
}
```

Or call one outside a form:

```jsx
'use client';
import { deletePost } from './actions';
import { useTransition } from 'react';

export function DeleteButton({ id }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button disabled={isPending} onClick={() => startTransition(() => deletePost(id))}>
      {isPending ? 'Deleting…' : 'Delete'}
    </button>
  );
}
```

Wrapping in a transition is what gives you the pending state and keeps the UI responsive ([React: Transition & Action Hooks](/reactJS/concurrent-hooks)).

---

## 4. Security — read this section twice

**A Server Action is a public HTTP endpoint.** Marking a function `'use server'` creates a callable URL. Anyone can POST to it with any arguments — the form you rendered is a suggestion, not a constraint.

```jsx
// ❌❌ CATASTROPHIC
'use server';
export async function deletePost(id) {
  await db.post.delete({ where: { id } });     // anyone can delete any post
}
```

```jsx
// ✅ authenticate, authorise, validate — every time
'use server';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function deletePost(rawId) {
  // 1. AUTHENTICATE
  const session = await auth();
  if (!session) throw new Error('Unauthorized');

  // 2. VALIDATE
  const { id } = DeleteSchema.parse({ id: rawId });

  // 3. AUTHORISE — does THIS user own THIS resource?
  const post = await db.post.findUnique({ where: { id }, select: { authorId: true } });
  if (!post) throw new Error('Not found');
  if (post.authorId !== session.user.id && session.user.role !== 'admin') {
    throw new Error('Forbidden');
  }

  // 4. ACT
  await db.post.delete({ where: { id } });
  revalidatePath('/posts');
}
```

Every action needs those four steps. Do not skip authorisation because "only the author sees the delete button" — the button's visibility is client-side and irrelevant.

### The hidden-field trap

```jsx
// ❌ trusting a value the client can edit
<input type="hidden" name="userId" value={session.user.id} />
```

```jsx
// ✅ read the identity on the server
const session = await auth();
await db.post.create({ data: { ...parsed.data, authorId: session.user.id } });
```

Never take identity, role, price or permission from the request body. Anything the client can change, the client will change.

### More hardening

```
□ Never expose an action that takes a raw table name, column or SQL fragment.
□ Rate-limit actions that send email, cost money, or hit external APIs.
□ Validate every argument with a schema — arguments are attacker-controlled.
□ Don't return internal error messages to the client.
□ Keep actions in files that are clearly server-side, and consider `server-only`.
□ Remember unused exports in a 'use server' file are still callable endpoints.
```

That last point catches people: deleting the UI that called an action does not remove the endpoint.

---

## 5. Return values and errors

```jsx
'use server';
export async function submit(prevState, formData) {
  try {
    const parsed = Schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.flatten().fieldErrors };   // expected failure
    }
    const result = await doWork(parsed.data);
    revalidatePath('/items');
    return { ok: true, id: result.id };
  } catch (e) {
    console.error(e);                                    // full detail in the server log
    return { ok: false, message: 'Something went wrong' };  // generic to the client
  }
}
```

**Return expected failures; throw for unexpected ones.** A validation error is data the UI needs, so return it. A database outage is exceptional, so let it hit the error boundary — but sanitise anything you hand back to the client.

Return values must be serialisable, same as any server→client value.

### `redirect` inside actions

```jsx
'use server';
export async function createAndGo(formData) {
  const post = await db.post.create({ … });
  revalidatePath('/posts');
  redirect(`/posts/${post.id}`);           // must be OUTSIDE any try/catch
}
```

`redirect` throws a special error. A broad `catch` will swallow it and your navigation silently won't happen.

---

## 6. Revalidation

```jsx
'use server';
export async function updatePost(id, formData) {
  await db.post.update({ … });

  revalidatePath(`/posts/${id}`);       // the detail page
  revalidateTag('posts');                // every list tagged 'posts'
  // The refreshed RSC payload rides back on the SAME response as the action result.
}
```

Without revalidation the mutation succeeds and the UI keeps showing stale data — the single most common Server Action bug ([Caching](./17-caching.md)).

---

## 7. Optimistic updates

```jsx
'use client';
import { useOptimistic } from 'react';
import { addTodo } from './actions';

export function TodoList({ todos }) {
  const [optimisticTodos, addOptimistic] = useOptimistic(
    todos,
    (state, newTodo) => [...state, { ...newTodo, id: 'temp', pending: true }]
  );

  async function action(formData) {
    const text = formData.get('text');
    addOptimistic({ text });                     // appears instantly
    await addTodo(formData);                     // the real mutation + revalidation
  }

  return (
    <>
      {optimisticTodos.map(t => (
        <li key={t.id} style={{ opacity: t.pending ? 0.5 : 1 }}>{t.text}</li>
      ))}
      <form action={action}><input name="text" /><button>Add</button></form>
    </>
  );
}
```

```
submit
  → the item appears immediately, dimmed
  → the action runs; revalidatePath re-renders the server list
  → React drops the optimistic entry and shows the real data
  → on FAILURE, the optimistic entry vanishes automatically — no rollback code
```

---

## 8. When to use an action vs a route handler

| | Server Action | Route Handler |
| :-- | :-- | :-- |
| Your own form/mutation | ✅ | ✗ unnecessary |
| Progressive enhancement (works without JS) | ✅ | ✗ |
| Auto-revalidating the UI in the same round trip | ✅ | ✗ |
| A webhook from Stripe/GitHub | ✗ | ✅ |
| A public API for mobile clients | ✗ | ✅ |
| File download / streaming / custom status codes | ✗ | ✅ |
| Being called by something that isn't your app | ✗ | ✅ |

Rule of thumb: **actions for your app's own writes, route handlers for anything external.**

---

## 9. Limits and gotchas

```
• Actions are always POST. There's no GET action.
• Body size is limited (default ~1 MB; configurable via serverActions.bodySizeLimit).
  Large uploads should go direct-to-storage with a presigned URL instead.
• Actions are queued: React runs them one at a time per form to preserve order.
• You cannot call an action during render — only from an event, a form, or a transition.
• 'use server' ≠ 'use client'. One marks server functions; the other marks a client
  bundle entry point. Putting 'use server' at the top of a component file is an error.
• Every export in a 'use server' file is a public endpoint, including unused ones.
```

---

## 10. Structuring actions

```
src/features/posts/
├── actions.ts        'use server' — mutations
├── queries.ts        import 'server-only' — reads, wrapped in cache()
└── schema.ts         Zod schemas shared by the form and the action
```

```ts
// schema.ts — one definition, used on both sides
export const PostSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
});
export type PostInput = z.infer<typeof PostSchema>;
```

The client form validates with it for instant feedback; the action validates with it for actual safety. Client-side validation is UX; server-side validation is security. You need both, and sharing the schema means they can't drift.

---

## 🧠 Rapid-fire recall

1. What does `'use server'` create, and why is that a security consideration?
2. Why does a form with an action work without JavaScript?
3. What comes back in a Server Action's response besides the return value?
4. List the four steps every action must perform.
5. Why is a hidden `userId` field wrong?
6. When should an action return an error vs throw one?
7. Give three cases where a Route Handler is correct and an action is not.

<details>
<summary>Answers</summary>

1. A publicly callable HTTP endpoint. Anyone can POST arbitrary arguments to it, so the rendered UI constrains nothing — every action must authenticate, validate and authorise for itself.
2. Next.js renders a real `<form method="POST">` targeting a generated endpoint; JavaScript only upgrades it to a fetch-based submission that avoids a full reload.
3. The updated RSC payload for any routes revalidated by the action, so the mutation and the UI refresh happen in one round trip and client state is preserved.
4. Authenticate the caller, validate the arguments with a schema, authorise this user for this specific resource, then perform the action (and revalidate).
5. The client can change any value it sends, including a hidden field. Identity, role, price and permissions must be read on the server from the session.
6. Return expected failures — validation errors the UI needs to display. Throw for unexpected ones so the error boundary handles them, but never return raw internal error messages to the client.
7. Webhooks from external services, public APIs for mobile or third-party clients, and responses needing custom status codes, streaming or file downloads.

</details>
