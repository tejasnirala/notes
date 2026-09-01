---
title: Forms & Mutations
author: Tejas Nirala
---

# Forms & Mutations

Putting Server Actions, validation, pending states and optimistic UI together into forms that are accessible, resilient and pleasant to use.

---

## 1. The progressive-enhancement baseline

```jsx
// app/contact/page.jsx — a Server Component, no client JS at all
import { submitContact } from './actions';

export default function Contact() {
  return (
    <form action={submitContact}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required />

      <label htmlFor="message">Message</label>
      <textarea id="message" name="message" required />

      <button type="submit">Send</button>
    </form>
  );
}
```

This form submits and works before a single byte of JavaScript has loaded. Everything below adds polish **on top of** a working baseline, rather than being a prerequisite for one. That's the design goal of the whole Actions API.

---

## 2. The full pattern: validation, errors and pending state

```ts
// schema.ts — one schema, used by both sides
import { z } from 'zod';

export const ContactSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
});
```

```ts
// actions.ts
'use server';
import { ContactSchema } from './schema';
import { revalidatePath } from 'next/cache';

export type State = {
  errors?: Record<string, string[]>;
  message?: string;
  success?: boolean;
};

export async function submitContact(prevState: State, formData: FormData): Promise<State> {
  const parsed = ContactSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, message: 'Please fix the errors below' };
  }

  try {
    await sendEmail(parsed.data);
  } catch (e) {
    console.error(e);
    return { message: 'Could not send your message. Please try again.' };
  }

  revalidatePath('/contact');
  return { success: true, message: 'Thanks — we’ll be in touch.' };
}
```

```jsx
// form.jsx
'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitContact } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();          // reads the ENCLOSING form's status
  return <button disabled={pending}>{pending ? 'Sending…' : 'Send'}</button>;
}

export function ContactForm() {
  const [state, formAction] = useActionState(submitContact, {});

  return (
    <form action={formAction}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email"
             aria-invalid={!!state.errors?.email}
             aria-describedby="email-error" />
      <p id="email-error" role="alert">{state.errors?.email?.[0]}</p>

      <label htmlFor="message">Message</label>
      <textarea id="message" name="message"
                aria-invalid={!!state.errors?.message}
                aria-describedby="message-error" />
      <p id="message-error" role="alert">{state.errors?.message?.[0]}</p>

      <SubmitButton />
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
```

Points worth noting:

- `useFormStatus` must be in a component **inside** the `<form>` — that's how it finds the form's context.
- `aria-invalid` and `aria-describedby` connect each error to its field so screen readers announce it.
- `role="alert"` announces errors immediately; `role="status"` announces the success message politely.
- The same Zod schema powers both client-side validation (if you add it) and the server's actual enforcement.

---

## 3. Client-side validation as an enhancement

```jsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ContactSchema } from './schema';

export function ContactForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm({ resolver: zodResolver(ContactSchema) });

  return (
    <form onSubmit={handleSubmit(async data => {
      const fd = new FormData();
      Object.entries(data).forEach(([k, v]) => fd.append(k, String(v)));
      await submitContact({}, fd);
    })}>
      <input {...register('email')} aria-invalid={!!errors.email} />
      {errors.email && <p role="alert">{errors.email.message}</p>}
      <button disabled={isSubmitting}>Send</button>
    </form>
  );
}
```

**Client validation is UX. Server validation is security.** Sharing the schema means they can never disagree, and you still get instant feedback without a round trip.

Note the trade: using `onSubmit` instead of `action` gives up progressive enhancement. For a signup form on a marketing site, keep `action`. For a complex multi-step wizard behind a login, `onSubmit` with a form library is usually the better developer experience.

---

## 4. Optimistic UI

```jsx
'use client';
import { useOptimistic } from 'react';
import { addComment } from './actions';

export function Comments({ comments, postId }) {
  const [optimistic, addOptimistic] = useOptimistic(
    comments,
    (state, text) => [...state, { id: 'temp', text, pending: true }]
  );

  async function action(formData) {
    const text = formData.get('text');
    addOptimistic(text);
    await addComment(postId, formData);        // the action revalidates → real data arrives
  }

  return (
    <>
      <ul>{optimistic.map(c => (
        <li key={c.id} style={{ opacity: c.pending ? 0.5 : 1 }}>{c.text}</li>
      ))}</ul>
      <form action={action}><input name="text" /><button>Post</button></form>
    </>
  );
}
```

```
submit
  t=0     the comment appears, dimmed                         ✅ instant
  t=0-300 the action runs; revalidatePath re-renders the list
  t=300   React drops the optimistic entry; the real one renders solid
  FAILURE the optimistic entry disappears automatically — no rollback code to write
```

The automatic rollback is the reason to use `useOptimistic` rather than hand-rolling with `useState`: hand-rolled optimistic UI is 80% rollback bookkeeping.

---

## 5. Resetting the form

```jsx
// uncontrolled: reset the DOM form after a successful submit
'use client';
const formRef = useRef(null);
const [state, formAction] = useActionState(action, {});

useEffect(() => { if (state.success) formRef.current?.reset(); }, [state.success]);

<form ref={formRef} action={formAction}>…</form>
```

```jsx
// or reset by identity — remount the form when its key changes
<ContactForm key={state.submissionId} />
```

The `key` approach is the React-native way to reset a subtree ([React: Components & Props](/reactJS/components-and-props)).

---

## 6. File uploads

```jsx
<form action={upload} encType="multipart/form-data">
  <input type="file" name="file" accept="image/*" required />
  <button>Upload</button>
</form>
```

```ts
'use server';
export async function upload(formData: FormData) {
  const file = formData.get('file') as File;

  if (!file || file.size === 0) return { error: 'No file provided' };
  if (file.size > 5 * 1024 * 1024) return { error: 'Max 5 MB' };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return { error: 'Images only' };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  await storage.put(`uploads/${crypto.randomUUID()}`, bytes);
  revalidatePath('/gallery');
}
```

⚠️ Server Actions have a body size limit (~1 MB by default). For anything larger, use **presigned direct-to-storage uploads**:

```
1. Client asks the server for a presigned URL (a small Server Action or route handler)
2. Client PUTs the file DIRECTLY to S3/R2/Blob — never through your server
3. Client calls an action with the resulting object key to record it in the database
```

That keeps large payloads off your server entirely, which matters even more on serverless where request size and duration are billed and capped.

Also: `file.type` comes from the client and can be spoofed. Validate the actual content server-side (magic bytes) if the file will be served back to users.

---

## 7. Multi-step forms

```jsx
'use client';
export function Wizard() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({});

  const next = (stepData) => { setData(d => ({ ...d, ...stepData })); setStep(s => s + 1); };

  return (
    <>
      <ol aria-label="Progress">{[1,2,3].map(n =>
        <li key={n} aria-current={step === n ? 'step' : undefined}>Step {n}</li>)}
      </ol>
      {step === 1 && <StepOne onNext={next} defaultValues={data} />}
      {step === 2 && <StepTwo onNext={next} onBack={() => setStep(1)} defaultValues={data} />}
      {step === 3 && <Review data={data} onSubmit={() => submitAll(data)} />}
    </>
  );
}
```

Accumulate on the client, submit once at the end. For long or valuable forms, persist the draft — to `localStorage`, or to the server on each step so a crash doesn't lose the user's work.

---

## 8. Accessibility checklist

```
□ Every input has a <label htmlFor> (or an aria-label)
□ Errors use aria-describedby, and the field has aria-invalid
□ Error messages have role="alert"; success uses role="status"
□ The submit button is disabled while pending, with visible text change
□ Focus moves to the first error on a failed submit
□ Required fields are marked with `required`, not just an asterisk in the label
□ The form is fully operable by keyboard
□ Autocomplete attributes are set (autoComplete="email", "new-password", …)
```

```jsx
// move focus to the first error
useEffect(() => {
  if (state.errors) {
    const first = Object.keys(state.errors)[0];
    document.getElementById(first)?.focus();
  }
}, [state.errors]);
```

That focus move is small and hugely valuable — without it, a keyboard or screen-reader user has no idea what failed or where.

---

## 9. Mistakes

```jsx
// 1. Client-side validation only → trivially bypassed
// 2. No revalidation after a mutation → the UI shows stale data
// 3. Trusting hidden fields for identity or price
// 4. Not disabling the submit button → double submissions
// 5. Losing progressive enhancement without a reason (onSubmit instead of action)
// 6. useFormStatus outside the <form> → always reports not-pending
// 7. Returning raw error objects/stack traces to the client
// 8. Uploading large files through a Server Action instead of direct-to-storage
```

---

## 🧠 Rapid-fire recall

1. Why does `<form action={serverAction}>` work without JavaScript?
2. Where must a component using `useFormStatus` be rendered?
3. What's the division of labour between client-side and server-side validation?
4. What does `useOptimistic` handle for you that a hand-rolled `useState` version doesn't?
5. Two ways to reset a form after a successful submit?
6. Why shouldn't large file uploads go through a Server Action?
7. Name four accessibility requirements for a form's error handling.

<details>
<summary>Answers</summary>

1. Next.js renders a genuine `<form method="POST">` pointing at a generated endpoint. JavaScript only upgrades the submission to a fetch that avoids a full page reload.
2. Inside the `<form>` element whose status it reports — it reads the enclosing form's context, so a component rendered beside the form always sees `pending: false`.
3. Client-side validation is UX: instant feedback with no round trip. Server-side validation is the actual enforcement, since anyone can POST directly to the action. Share one schema so they can't drift.
4. Automatic rollback — if the action fails, the optimistic entry is discarded without any manual snapshot-and-restore code.
5. Call `.reset()` on the form via a ref in an effect keyed on success, or change the form component's `key` so React remounts it fresh.
6. Server Actions have a body size limit (~1 MB by default) and route the whole payload through your server, which is slow and expensive on serverless. Use presigned direct-to-storage uploads instead.
7. `aria-describedby` linking the error to the field, `aria-invalid` on the field, `role="alert"` on the message, and moving focus to the first invalid field after a failed submit.

</details>
