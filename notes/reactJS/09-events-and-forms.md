---
title: Events & Forms
author: Tejas Nirala
---

# Events & Forms

Two topics that belong together, because forms are where React's event system, controlled state, and the DOM's own quirks collide.

---

## 1. React's synthetic event system

```jsx
<button onClick={handleClick}>Save</button>
```

This looks like it attaches a listener to that button. **It does not.**

```
                 ┌──────────────────────────────────────────┐
                 │  root container (#root)                  │
                 │  ONE real listener per event type,       │
                 │  attached here by react-dom              │
                 └──────────────────┬───────────────────────┘
                                    │ a real click bubbles up to here
   ┌────────────────────────────────┴─────────────────────────────┐
   │ React reads the event target, walks UP its own fiber tree,   │
   │ collects every onClick along the path, and calls them in     │
   │ order — simulating capture then bubble.                      │
   └──────────────────────────────────────────────────────────────┘
```

Why React does this:

| Benefit | Detail |
| :-- | :-- |
| **One listener, not N** | 10,000 rows with `onClick` = 1 real DOM listener |
| **Consistent behaviour** | Normalises historical browser differences |
| **Works with concurrent rendering** | React controls dispatch ordering and can batch |
| **Automatic batching** | All setState calls in one handler produce one render |

The object your handler receives is a `SyntheticEvent` — a wrapper with a normalised API and `e.nativeEvent` for the real thing.

> React ≤16 attached the root listener to `document` and **pooled** synthetic events (reusing the object, requiring `e.persist()`). React 17 moved the root to the app container (so multiple React versions can coexist) and **removed pooling** — you can now safely use `e` asynchronously.

### Practical consequences

```jsx
// e.stopPropagation() stops React's synthetic propagation…
<div onClick={outer}>
  <button onClick={e => e.stopPropagation()}>x</button>   {/* outer won't fire */}
</div>

// …but a NATIVE listener added with addEventListener sits OUTSIDE React's system.
useEffect(() => {
  document.addEventListener('click', close);   // fires even when React handlers stop propagation
  return () => document.removeEventListener('click', close);
}, []);
```

This is why "click outside to close a dropdown" is subtle: your native document listener runs *after* React's root listener (which is also on the container), so the click that opened the menu can immediately close it. The usual fixes: check `e.target` containment with a ref, use the capture phase, or attach on `mousedown` vs `click` deliberately.

---

## 2. Handler basics

```jsx
<button onClick={handleClick}>       {/* ✅ pass the function */}
<button onClick={handleClick()}>     {/* ❌ CALLS it during render */}
<button onClick={() => save(id)}>    {/* ✅ wrap when you need arguments */}
```

Naming convention: the prop is `onX`, the implementation is `handleX`.

```jsx
function Toolbar({ onSave }) {
  return <button onClick={onSave}>Save</button>;
}

function Editor() {
  function handleSave() { … }
  return <Toolbar onSave={handleSave} />;
}
```

### The event object

```jsx
function handle(e) {
  e.target;             // the element that triggered it
  e.currentTarget;      // the element the handler is attached to
  e.preventDefault();   // cancel the browser default (submit, navigate, etc.)
  e.stopPropagation();  // stop React's synthetic bubbling
  e.nativeEvent;        // the real browser event
  e.key;                // keyboard events
}
```

### Capture phase

```jsx
<div onClickCapture={fn}>   {/* runs on the way DOWN, before children */}
```

Useful for analytics or intercepting clicks before a child can `stopPropagation`.

---

## 3. Controlled vs uncontrolled inputs

This is the core forms decision.

### Controlled — React state is the single source of truth

```jsx
function NameField() {
  const [name, setName] = useState('');
  return <input value={name} onChange={e => setName(e.target.value)} />;
}
```

**Trace one keystroke:**

```
1. user types "A"
2. browser fires an input event
3. React's root listener dispatches → onChange handler runs
4. setName('A') → schedules a render
5. re-render → <input value="A" />
6. React's DOM diff sets the input's value property to "A"
7. the character appears on screen
```

The character you see is the one React put back. If step 4 is missing, the input is frozen:

```jsx
<input value={name} />          // ❌ read-only in practice; React warns
<input value={name} readOnly /> // ✅ if that's genuinely what you want
<input defaultValue={name} />   // ✅ uncontrolled with an initial value
```

Also note: `value={undefined}` makes an input *uncontrolled*, and switching later to a defined value produces the "changing an uncontrolled input to be controlled" warning. Always initialise with `''`, never `undefined` or `null`.

### Uncontrolled — the DOM keeps the value, you read it when you need it

```jsx
function NameField() {
  const ref = useRef(null);
  function submit(e) {
    e.preventDefault();
    console.log(ref.current.value);      // read on demand
  }
  return <form onSubmit={submit}><input ref={ref} defaultValue="Ada" /></form>;
}
```

### Choosing

| | Controlled | Uncontrolled |
| :-- | :-- | :-- |
| Source of truth | React state | the DOM node |
| Re-render per keystroke | yes | no |
| Instant validation / formatting / conditional UI | ✅ easy | ❌ awkward |
| Large forms performance | can be a problem | ✅ fast |
| File inputs | impossible (read-only by spec) | ✅ required |
| Integrating a non-React widget | hard | ✅ natural |

Default to controlled. Move to uncontrolled (or a library like React Hook Form, which is uncontrolled under the hood) when a big form starts re-rendering on every keystroke.

---

## 4. All the input types

```jsx
// text / textarea — children are NOT used for textarea in React
<input  type="text" value={v} onChange={e => set(e.target.value)} />
<textarea value={v} onChange={e => set(e.target.value)} />

// number — e.target.value is ALWAYS a string
<input type="number" value={n} onChange={e => setN(e.target.valueAsNumber)} />

// checkbox — use `checked`, and read `e.target.checked`
<input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} />

// radio group — same `name`, compare value
<input type="radio" name="size" value="s" checked={size === 's'} onChange={e => setSize(e.target.value)} />

// select — value on the <select>, not `selected` on options
<select value={sel} onChange={e => setSel(e.target.value)}>
  <option value="a">A</option>
</select>

// multi-select
<select multiple value={arr}
        onChange={e => setArr([...e.target.selectedOptions].map(o => o.value))} />

// file — ALWAYS uncontrolled
<input type="file" ref={fileRef} onChange={e => setFile(e.target.files[0])} />
```

---

## 5. A whole form with one state object

```jsx
function SignupForm() {
  const [form, setForm]     = useState({ name: '', email: '', plan: 'free', terms: false });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle');   // idle | submitting | success | error

  function handleChange(e) {
    const { name, type, value, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  }

  function validate(f) {
    const err = {};
    if (!f.name.trim())            err.name  = 'Name is required';
    if (!/^\S+@\S+\.\S+$/.test(f.email)) err.email = 'Invalid email';
    if (!f.terms)                  err.terms = 'You must accept the terms';
    return err;
  }

  async function handleSubmit(e) {
    e.preventDefault();                       // stop the browser's full-page POST
    const err = validate(form);
    setErrors(err);
    if (Object.keys(err).length) return;

    setStatus('submitting');
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus('success');
    } catch (e) {
      setErrors({ form: e.message });
      setStatus('error');
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor="name">Name</label>
      <input id="name" name="name" value={form.name} onChange={handleChange}
             aria-invalid={!!errors.name} aria-describedby="name-err" />
      {errors.name && <p id="name-err" role="alert">{errors.name}</p>}

      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" value={form.email} onChange={handleChange} />
      {errors.email && <p role="alert">{errors.email}</p>}

      <label>
        <input type="checkbox" name="terms" checked={form.terms} onChange={handleChange} />
        I accept the terms
      </label>

      <button disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Signing up…' : 'Sign up'}
      </button>
    </form>
  );
}
```

Points worth noticing:

- `e.preventDefault()` is mandatory — otherwise the browser does a native form POST and reloads the page.
- One `handleChange` serves every field via the computed key `[name]`.
- `status` is a single enum, not three booleans ([State](./08-state-and-usestate.md)).
- Every input has a `<label htmlFor>`; errors use `role="alert"` so screen readers announce them.
- The submit button is disabled while in flight — the cheapest double-submit guard.

---

## 6. Validation timing

Validating on every keystroke is hostile — the user sees "invalid email" while typing the first character. The standard pattern:

```jsx
const [touched, setTouched] = useState({});

<input
  name="email"
  value={form.email}
  onChange={handleChange}
  onBlur={() => setTouched(t => ({ ...t, email: true }))}
/>
{touched.email && errors.email && <p role="alert">{errors.email}</p>}
```

```
typing …            → no error shown (not touched)
blur                → touched.email = true → error appears if invalid
typing again        → error updates live, because now it's relevant
```

---

## 7. Debouncing input

For search-as-you-type, you want the input responsive but the request rare.

```jsx
function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);      // cancel the previous timer on each keystroke
  }, [value, delay]);
  return debounced;
}

function Search() {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);

  useEffect(() => {
    if (!debounced) return;
    const ac = new AbortController();
    fetch(`/api/search?q=${debounced}`, { signal: ac.signal })
      .then(r => r.json()).then(setResults)
      .catch(e => { if (e.name !== 'AbortError') setError(e); });
    return () => ac.abort();
  }, [debounced]);

  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}
```

**Trace typing "rea" quickly, then pausing:**

```
t=0    'r'   → effect: timer A set for t=300
t=100  're'  → cleanup cancels timer A; timer B set for t=400
t=200  'rea' → cleanup cancels timer B; timer C set for t=500
t=500  timer C fires → debounced = 'rea' → the fetch effect runs ONCE
```

Three keystrokes, one request. React 18 also offers `useDeferredValue` for the *rendering* half of this problem ([Concurrent Hooks](./25-concurrent-hooks.md)).

---

## 8. Form libraries — when to reach for one

| Library | Approach | Use when |
| :-- | :-- | :-- |
| **React Hook Form** | Uncontrolled + refs, minimal re-renders | Large or performance-sensitive forms |
| **Formik** | Controlled, batteries-included | Legacy codebases; still common |
| **TanStack Form** | Type-first, framework-agnostic | Heavy TypeScript use |
| **Zod / Yup / Valibot** | Schema validation | Pair with any of the above; share the schema with your server |

```jsx
// React Hook Form + Zod, the current default stack
const { register, handleSubmit, formState: { errors } } =
  useForm({ resolver: zodResolver(schema) });

<form onSubmit={handleSubmit(onValid)}>
  <input {...register('email')} />
  {errors.email && <p>{errors.email.message}</p>}
</form>
```

Roll your own for a login form. Use a library the moment you have arrays of fields, cross-field validation, or wizards.

---

## 🧠 Rapid-fire recall

1. Where does React actually attach the DOM listener for `onClick`, and why?
2. What changed about synthetic events in React 17?
3. Why does a native `document` click listener fire even when a React handler called `stopPropagation()`?
4. Trace what happens between pressing a key and seeing the character in a controlled input.
5. Why does `<input value={name} />` with no `onChange` appear frozen?
6. Which input type can never be controlled, and why?
7. Explain the debounce trace for three fast keystrokes, and what the cleanup function is doing.

<details>
<summary>Answers</summary>

1. One listener per event type on the **root container** (React 17+; `document` in React 16). React then walks its own fiber tree from the target upward and invokes the collected handlers, giving delegation, batching and consistent cross-browser behaviour with a single real listener.
2. The root moved from `document` to the app container (so multiple React roots/versions can coexist), and event pooling was removed, so the event object is safe to use asynchronously — `e.persist()` is no longer needed.
3. Native listeners aren't part of React's synthetic system. `stopPropagation` on a synthetic event stops React's simulated propagation, not other real listeners already reached at or above the root container.
4. Key → browser input event → React root listener dispatches → your `onChange` → `setState` → re-render → React sets the DOM node's `value` property to the new state. The character on screen is the one React wrote back.
5. `value` pins the input to a state that never changes, so React resets the DOM value after every keystroke. Add `onChange`, or use `readOnly`/`defaultValue`.
6. `<input type="file">` — its value is read-only by specification for security, so it must be uncontrolled and read via a ref or `e.target.files`.
7. Each keystroke re-runs the effect; its cleanup clears the previous `setTimeout` before the new one is set, so only the timer from the last keystroke survives the pause and fires — one debounced update, one request.

</details>
