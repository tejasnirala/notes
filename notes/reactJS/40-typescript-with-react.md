---
title: TypeScript with React
author: Tejas Nirala
---

# TypeScript with React

TypeScript's value in React is concentrated in a few places: prop contracts, discriminated unions for state, and generic components. This page covers those, plus the type signatures you'll look up constantly.

---

## 1. Typing components and props

```tsx
type ButtonProps = {
  label: string;
  variant?: 'primary' | 'secondary';        // a union, not `string` — autocomplete + safety
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children?: React.ReactNode;
};

function Button({ label, variant = 'primary', onClick, children }: ButtonProps) {
  return <button className={variant} onClick={onClick}>{label}{children}</button>;
}
```

**Don't use `React.FC`** unless you have a reason:

```tsx
const Button: React.FC<ButtonProps> = ({ label }) => …;   // ⚠️ legacy
```

It used to add an implicit `children` (removed in React 18 types), it complicates generics, and it forces a specific return type. A plain function with a typed parameter is simpler and infers better.

### `type` vs `interface`

```tsx
interface Props { name: string }            // extendable via declaration merging
type Props = { name: string };              // supports unions, intersections, mapped types
```

Use `type` by default (it does everything), `interface` when you're publishing a library and want consumers to be able to augment it. Consistency matters more than the choice.

---

## 2. The React types you'll look up

```tsx
React.ReactNode          // anything renderable: elements, strings, numbers, arrays, null
React.ReactElement       // specifically a JSX element (narrower)
React.JSX.Element        // the return type of a component
React.CSSProperties      // the `style` prop
React.ComponentProps<typeof Button>            // extract another component's props
React.ComponentPropsWithoutRef<'button'>       // all native <button> props
React.PropsWithChildren<T>                     // T & { children?: ReactNode }

// Events
React.MouseEvent<HTMLButtonElement>
React.ChangeEvent<HTMLInputElement>
React.FormEvent<HTMLFormElement>
React.KeyboardEvent<HTMLInputElement>
React.FocusEvent<HTMLInputElement>

// Handlers (often shorter)
React.MouseEventHandler<HTMLButtonElement>
React.ChangeEventHandler<HTMLInputElement>

// Refs
React.RefObject<HTMLDivElement>
React.Dispatch<React.SetStateAction<number>>   // the type of a useState setter
```

### Extending native element props — the pattern for design systems

```tsx
type ButtonProps = React.ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'danger';
};

function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  return <button className={cn(styles[variant], className)} {...rest} />;
}

<Button variant="danger" onClick={fn} disabled aria-label="Delete" type="submit" />
// every native button prop is typed and autocompleted ✅
```

---

## 3. Typing hooks

```tsx
// useState — usually inferred
const [count, setCount] = useState(0);                    // number
const [user, setUser] = useState<User | null>(null);      // ← annotate when it starts null
const [items, setItems] = useState<Todo[]>([]);           // ← annotate empty arrays

// useRef — the two distinct forms
const inputRef = useRef<HTMLInputElement>(null);          // for a DOM ref: readonly, may be null
const timerRef = useRef<number | undefined>(undefined);   // for a mutable box

inputRef.current?.focus();                                 // ← always optional-chain DOM refs

// useReducer
type State = { count: number };
type Action = { type: 'inc' } | { type: 'set'; value: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'inc': return { count: state.count + 1 };
    case 'set': return { count: action.value };            // `value` is known to exist here
  }                                                         // exhaustive → no default needed
}

// useContext — the non-null pattern
const AuthContext = createContext<AuthValue | undefined>(undefined);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;                                              // narrowed to AuthValue ✅
}
```

The `useAuth` pattern is worth internalising: the runtime guard doubles as the type narrowing, so every consumer gets a non-nullable value without `!`.

---

## 4. Discriminated unions — the highest-value pattern

Make illegal states unrepresentable.

```tsx
// ❌ 2⁴ = 16 combinations, most of them nonsense
type State = {
  isLoading: boolean;
  data: User | null;
  error: Error | null;
  isSuccess: boolean;
};

// ✅ exactly four valid shapes
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: User }
  | { status: 'error'; error: Error };
```

```tsx
function render(state: State) {
  switch (state.status) {
    case 'idle':    return null;
    case 'loading': return <Skeleton />;
    case 'success': return <Profile user={state.data} />;    // `data` exists, guaranteed
    case 'error':   return <Error error={state.error} />;    // `error` exists
  }
}
```

TypeScript narrows on the `status` field, so `state.data` is only accessible in the success branch — the compiler makes "read the data while loading" a compile error rather than a runtime crash.

### Exhaustiveness checking

```tsx
function assertNever(x: never): never {
  throw new Error(`Unexpected: ${JSON.stringify(x)}`);
}

switch (state.status) {
  case 'idle': …
  case 'loading': …
  case 'success': …
  case 'error': …
  default: return assertNever(state);     // ← adding a 5th status breaks the BUILD
}
```

Adding a variant to the union now produces a compile error at every switch that doesn't handle it. This is the single most useful TypeScript technique in React.

---

## 5. Generic components

```tsx
type ListProps<T> = {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyExtractor: (item: T) => string;
};

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return <ul>{items.map(i => <li key={keyExtractor(i)}>{renderItem(i)}</li>)}</ul>;
}

<List
  items={users}                              // T inferred as User
  renderItem={u => u.name}                   // `u` is User — fully typed ✅
  keyExtractor={u => u.id}
/>
```

Constrain when you need a shape:

```tsx
function Table<T extends { id: string }>({ rows }: { rows: T[] }) {
  return <>{rows.map(r => <tr key={r.id} />)}</>;   // `id` is guaranteed
}
```

⚠️ In `.tsx` files, `<T>` is ambiguous with JSX in arrow functions. Use a function declaration, or `<T,>`:

```tsx
const List = <T,>({ items }: Props<T>) => …;    // the trailing comma disambiguates
```

---

## 6. Typing events and forms

```tsx
function Form() {
  const [email, setEmail] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);                    // `value` is typed as string
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);  // currentTarget is HTMLFormElement ✅
    const email = data.get('email') as string;
  };

  return <form onSubmit={handleSubmit}><input onChange={handleChange} /></form>;
}
```

`e.currentTarget` is typed to the element the handler is on; `e.target` is typed as `EventTarget` and often needs narrowing — prefer `currentTarget` when you mean "this element".

---

## 7. Refs and `forwardRef`

```tsx
// React 19 — ref is a normal prop
type InputProps = React.ComponentPropsWithoutRef<'input'> & {
  ref?: React.Ref<HTMLInputElement>;
};
function Input({ ref, ...props }: InputProps) {
  return <input ref={ref} {...props} />;
}

// React ≤18
const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => (
  <input ref={ref} {...props} />
));
// note the argument order: <ElementType, PropsType> — the reverse of what you'd guess
```

---

## 8. Utility types you'll actually use

```tsx
Partial<T>              // all properties optional
Required<T>
Pick<Props, 'a' | 'b'>
Omit<Props, 'onClick'>  // ← very common: extend a component but replace a prop
Record<string, User>
Readonly<T>
NonNullable<T>
ReturnType<typeof useAuth>
Parameters<typeof fn>
Awaited<ReturnType<typeof fetchUser>>     // unwrap a promise return type

// Useful compositions
type PropsWithoutClick = Omit<ButtonProps, 'onClick'> & { onClick: () => Promise<void> };
type Keys = keyof User;                              // 'id' | 'name' | 'email'
type Status = (typeof STATUSES)[number];             // a union from a const array
const STATUSES = ['idle', 'loading', 'done'] as const;
```

---

## 9. Config that matters

```json
{
  "compilerOptions": {
    "strict": true,                          // non-negotiable
    "noUncheckedIndexedAccess": true,        // arr[0] is T | undefined — catches real bugs
    "jsx": "react-jsx",                      // no need to import React
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,            // enforces `import type`
    "noUnusedLocals": true
  }
}
```

`strict: true` is where 90% of TypeScript's value comes from. Without `strictNullChecks`, `user.name` on a possibly-null user compiles fine and crashes at runtime — the exact bug you adopted TypeScript to prevent.

---

## 10. Anti-patterns

```tsx
// ❌ `any` — turns off the compiler for that value and everything it touches
const data: any = await res.json();
// ✅ `unknown` forces you to narrow, or validate with Zod
const data: unknown = await res.json();
const user = UserSchema.parse(data);          // runtime-validated AND typed

// ❌ non-null assertions everywhere
ref.current!.focus();
// ✅
ref.current?.focus();

// ❌ over-broad prop types
type Props = { variant: string };
// ✅
type Props = { variant: 'primary' | 'secondary' };

// ❌ casting to silence an error
const el = e.target as HTMLInputElement;      // sometimes necessary, often a smell
// ✅ use e.currentTarget, which is already typed

// ❌ typing what can be inferred
const [count, setCount] = useState<number>(0);   // the annotation adds nothing
```

### Validate at the boundary

Types are erased at runtime. An API response typed as `User` is only a *claim*.

```tsx
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});
type User = z.infer<typeof UserSchema>;      // ← one source of truth

async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return UserSchema.parse(await res.json());  // throws if the server lied
}
```

One schema gives you the runtime guard, the TypeScript type, and (with `zodResolver`) form validation.

---

## 🧠 Rapid-fire recall

1. Why avoid `React.FC`?
2. When must you annotate `useState`, and when is inference enough?
3. What's the difference between the two `useRef` forms?
4. Why is a discriminated union better than four boolean flags?
5. What does `assertNever` buy you?
6. How do you extend a native `<button>`'s props?
7. Why does an API response typed as `User` not guarantee it *is* a `User`, and what's the fix?

<details>
<summary>Answers</summary>

1. It historically added an implicit `children`, complicates generic components, and constrains the return type. A plain function with a typed props parameter infers better and reads more simply.
2. Annotate when the initial value doesn't represent the full type — `useState<User | null>(null)`, `useState<Todo[]>([])`. Inference is enough when the initial value already has the right type.
3. `useRef<HTMLInputElement>(null)` produces a read-only ref intended for the `ref` attribute; `useRef<T | undefined>(undefined)` produces a mutable box you assign to yourself.
4. Four booleans allow 16 combinations, most meaningless (loading *and* success). A discriminated union has exactly the valid shapes, and TypeScript narrows so `data` is only reachable in the success branch.
5. Compile-time exhaustiveness: adding a new variant to the union makes every switch that doesn't handle it fail the build, instead of silently falling through at runtime.
6. `type Props = React.ComponentPropsWithoutRef<'button'> & { variant?: … }`, then destructure your own props and spread `...rest` onto the element.
7. Types are erased at compile time, so the annotation is an unverified claim about data from the network. Validate at the boundary with a runtime schema (Zod), and derive the type from the schema so there's one source of truth.

</details>
