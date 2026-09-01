---
title: Portals, Modals & Accessibility
author: Tejas Nirala
---

# Portals, Modals & Accessibility

A portal renders a component's DOM output somewhere else in the document while keeping it in the React tree. Modals are the reason it exists, and modals are also where accessibility usually goes wrong — so both belong on one page.

---

## 1. `createPortal`

```jsx
import { createPortal } from 'react-dom';

function Modal({ children }) {
  return createPortal(
    <div className="overlay">{children}</div>,
    document.body                                 // ← the DOM destination
  );
}
```

The key property:

```
REACT TREE                          DOM TREE
App                                 body
 └─ Page                             ├─ div#root
     └─ Card                         │   └─ div.page
         └─ Modal      ─────────┐    │       └─ div.card
             └─ Content         │    │
                                └────┴─ div.overlay      ← rendered HERE
                                          └─ content
```

- **Context still flows** — `Modal`'s children can read `ThemeContext` from `App`.
- **Events still bubble through the React tree**, not the DOM tree. A click inside the portal fires `onClick` handlers on `Card` and `Page`, even though the DOM node isn't inside them. This surprises people constantly.
- **State, refs and effects behave normally.**

```jsx
<div onClick={() => console.log('card clicked')}>
  <Modal><button>Click me</button></Modal>       {/* logs "card clicked" ✅ */}
</div>
```

If that's not what you want, stop the propagation inside the portal.

---

## 2. Why portals exist: the CSS clipping problem

```css
.card { overflow: hidden; }          /* clips anything sticking out */
.header { transform: translateZ(0); }/* creates a containing block for `fixed` */
.sidebar { z-index: 10; }            /* a stacking context your modal can't escape */
```

A dropdown or tooltip rendered inside `.card` gets clipped by `overflow: hidden`. No `z-index` can save it — the clip happens before stacking is considered. And `position: fixed` doesn't escape an ancestor with a `transform`, `filter` or `will-change`, because those create a containing block.

```
Without a portal:                 With a portal:
body                              body
 └─ .card (overflow:hidden)        ├─ .card (overflow:hidden)
     └─ .dropdown  ← CLIPPED ✂️    └─ .dropdown  ← free ✅
```

Portals sidestep all of it by moving the node to `document.body`, outside every problematic ancestor.

---

## 3. A portal into a dedicated container

Rendering into `document.body` directly can conflict with other libraries. Use a mount node:

```html
<body>
  <div id="root"></div>
  <div id="portal-root"></div>
</body>
```

```jsx
function Portal({ children, containerId = 'portal-root' }) {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    let el = document.getElementById(containerId);
    let created = false;
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      document.body.appendChild(el);
      created = true;
    }
    setContainer(el);
    return () => { if (created) el.remove(); };
  }, [containerId]);

  if (!container) return null;        // SSR-safe: nothing renders on the server
  return createPortal(children, container);
}
```

The `useState` + `useEffect` dance is deliberate: `document` doesn't exist during SSR, so you must defer to after mount and render `null` on the first pass.

---

## 4. A modal done properly

Accessibility is not optional here — a modal that traps nobody and announces nothing is unusable with a keyboard or screen reader.

```jsx
function Modal({ isOpen, onClose, title, children }) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  // 1. Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // 2. Lock background scroll
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // 3. Focus management: move focus in, and restore it on close
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement;
    dialogRef.current?.focus();
    return () => previouslyFocused.current?.focus();     // ← the step everyone forgets
  }, [isOpen]);

  // 4. Focus trap
  function onKeyDown(e) {
    if (e.key !== 'Tab') return;
    const focusables = dialogRef.current.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  if (!isOpen) return null;

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={e => e.stopPropagation()}     {/* don't close when clicking inside */}
      >
        <h2 id="modal-title">{title}</h2>
        {children}
        <button onClick={onClose} aria-label="Close">×</button>
      </div>
    </div>,
    document.body
  );
}
```

**The accessibility checklist, and what each line buys:**

| Requirement | Implementation | Without it |
| :-- | :-- | :-- |
| Announced as a dialog | `role="dialog"` + `aria-modal` | Screen reader users don't know context changed |
| Has a name | `aria-labelledby` → the heading | Announced as "dialog", nothing more |
| Focus moves in | `dialogRef.current.focus()` | Keyboard users are still on the page behind |
| Focus is trapped | the Tab handler | Tab escapes to the page behind the overlay |
| Focus is restored | `previouslyFocused.current.focus()` | Focus jumps to `<body>`; the user loses their place |
| Escape closes | `keydown` listener | No keyboard exit |
| Background doesn't scroll | `body { overflow: hidden }` | The page scrolls behind the modal |
| Backdrop click closes | overlay `onClick` + `stopPropagation` inside | No mouse exit, or it closes on every internal click |

---

## 5. The native `<dialog>` element

Modern browsers give you most of this for free:

```jsx
function Modal({ isOpen, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (isOpen) el.showModal();      // focus trap, inertness, Escape, ::backdrop — all native
    else el.close();
  }, [isOpen]);

  return (
    <dialog ref={ref} onClose={onClose} onClick={e => {
      if (e.target === ref.current) onClose();     // backdrop click
    }}>
      {children}
    </dialog>
  );
}
```

`showModal()` gives you: the top layer (no z-index fights), a focus trap, `inert` on the rest of the page, Escape to close, and a `::backdrop` pseudo-element. It's less code and more correct.

Caveats: styling `::backdrop` and animating open/close needs care, and `showModal()` on an already-open dialog throws. In production, prefer a library that has already solved this — **Radix Dialog** or **React Aria** are the two credible choices, and both handle screen-reader quirks you will not think of.

---

## 6. Other portal use cases

```jsx
// Tooltips and popovers — escape overflow:hidden
createPortal(<Tooltip />, document.body);

// Toasts — one container, rendered from anywhere
createPortal(<Toast />, document.getElementById('toast-root'));

// Rendering React into a non-React part of the page (a legacy widget slot)
createPortal(<ReactWidget />, document.querySelector('#legacy-slot'));

// Rendering into an iframe or a Shadow DOM root
createPortal(<Content />, iframeRef.current.contentDocument.body);
```

For popovers specifically, use **Floating UI** (`@floating-ui/react`) rather than hand-rolled positioning — it handles flipping, shifting, collision detection and virtual elements.

---

## 7. Portals and event bubbling — the gotcha, traced

```jsx
function App() {
  return (
    <div onClick={() => console.log('outer')}>
      <Portal>
        <button onClick={() => console.log('button')}>Click</button>
      </Portal>
    </div>
  );
}
```

```
Click the button (which is physically in document.body, NOT inside the div):

DOM:    button → body → html          (the div is not an ancestor)
React:  button → Portal → div → App   (React uses ITS OWN tree)

Console: "button", then "outer"       ← the div's handler fires
```

This is by design — it keeps the React tree the single source of truth for event flow. But it means a "click outside to close" implemented with a React `onClick` on a wrapper will fire for clicks inside the portal. Implement click-outside with a `document` listener plus `ref.contains(e.target)` instead ([Custom Hooks](./27-custom-hooks.md)).

---

## 🧠 Rapid-fire recall

1. What does a portal change, and what does it deliberately not change?
2. Give two CSS situations that make a portal necessary.
3. Through which tree do events bubble from a portal?
4. Why does a portal component need `useState` + `useEffect` before rendering?
5. List five things a modal must do to be accessible.
6. What does the native `<dialog>`'s `showModal()` give you for free?
7. Why does a click-outside handler based on React `onClick` fail with portals?

<details>
<summary>Answers</summary>

1. It changes where the DOM nodes are inserted. It does not change the React tree — context, state, refs, effects and event bubbling all still follow the component hierarchy.
2. An ancestor with `overflow: hidden` clipping a dropdown, and an ancestor with `transform`/`filter`/`will-change` creating a containing block that `position: fixed` can't escape. (Also stacking contexts that `z-index` can't beat.)
3. The React tree. A click inside a portal fires handlers on the portal's React ancestors, even though those elements aren't DOM ancestors.
4. `document` doesn't exist during server rendering, so the container must be resolved after mount; the component renders `null` on the first pass.
5. `role="dialog"` with `aria-modal`, an accessible name via `aria-labelledby`, moving focus into the dialog, trapping Tab inside it, restoring focus to the trigger on close, Escape to close, and locking background scroll.
6. The top layer (no z-index conflicts), a native focus trap, `inert` on the rest of the page, Escape to close, and a `::backdrop` pseudo-element.
7. Events from a portal bubble through the React tree, so a click *inside* the portal reaches the wrapper's `onClick` and is misread as an outside click. Use a `document` listener with `ref.contains(e.target)`.

</details>
