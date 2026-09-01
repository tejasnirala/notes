---
title: Testing React
author: Tejas Nirala
---

# Testing React

The guiding principle, from Testing Library's author:

> **The more your tests resemble the way your software is used, the more confidence they give you.**

Test what the user does, not what the component does internally. A test that breaks when you rename a state variable is a liability; a test that breaks when the button stops working is an asset.

---

## 1. The stack

```bash
npm i -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

```js
// vitest.config.js
export default defineConfig({
  test: { environment: 'jsdom', globals: true, setupFiles: './src/setupTests.js' },
});

// src/setupTests.js
import '@testing-library/jest-dom';        // adds toBeInTheDocument, toBeDisabled, …
```

Vitest and Jest have nearly identical APIs; Vitest is faster and shares your Vite config.

---

## 2. The shape of a test

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('increments the counter when clicked', async () => {
  const user = userEvent.setup();
  render(<Counter />);                                       // ARRANGE

  await user.click(screen.getByRole('button', { name: /increment/i }));   // ACT

  expect(screen.getByText('Count: 1')).toBeInTheDocument();  // ASSERT
});
```

Note there is no reference to `useState`, no reaching into the instance, no snapshot of internals. If you rewrote `Counter` with `useReducer`, this test would still pass — which is exactly what you want.

---

## 3. Queries: the priority order

Testing Library deliberately makes accessible queries the easiest ones, so writing good tests pushes you toward accessible markup.

```jsx
// 1. Accessible to everyone — ALWAYS PREFER THESE
screen.getByRole('button', { name: /submit/i });
screen.getByLabelText('Email address');
screen.getByPlaceholderText('Search…');
screen.getByText(/welcome back/i);
screen.getByDisplayValue('current value');

// 2. Semantic
screen.getByAltText('Company logo');
screen.getByTitle('Close');

// 3. Escape hatch — only when nothing above works
screen.getByTestId('custom-widget');
```

If you can't query by role or label, that's usually a **real accessibility bug** your test just found.

### get / query / find

| Prefix | Not found | Found | Async |
| :-- | :-- | :-- | :-- |
| `getBy` | **throws** | element | no |
| `queryBy` | returns `null` | element | no |
| `findBy` | rejects | element | **yes** (retries until timeout) |

```jsx
expect(screen.queryByText('Error')).not.toBeInTheDocument();   // ✅ asserting absence
expect(screen.getByText('Error')).not.toBeInTheDocument();     // ❌ throws before asserting

expect(await screen.findByText('Loaded')).toBeInTheDocument(); // ✅ waits for async
```

Plural forms (`getAllBy…`) return arrays and throw if there are none.

---

## 4. `userEvent` over `fireEvent`

```jsx
fireEvent.change(input, { target: { value: 'hello' } });   // one synthetic event

await user.type(input, 'hello');                            // ✅ realistic:
// pointer down/up, focus, keydown, keypress, input, keyup — per character
```

`userEvent` simulates what a real user's interaction produces, so it catches bugs `fireEvent` misses (a handler on `keydown`, a disabled button that shouldn't be clickable, focus management).

```jsx
const user = userEvent.setup();
await user.click(el);
await user.dblClick(el);
await user.type(input, 'text{enter}');
await user.clear(input);
await user.selectOptions(select, 'value');
await user.upload(fileInput, file);
await user.tab();                       // keyboard navigation
await user.keyboard('{Shift>}A{/Shift}');
await user.hover(el);
```

Everything returns a promise — always `await`.

---

## 5. Async and `waitFor`

```jsx
test('loads and displays the user', async () => {
  render(<Profile userId="1" />);

  expect(screen.getByText(/loading/i)).toBeInTheDocument();

  expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();   // ✅ preferred
  expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
});

// waitFor — for assertions that aren't "an element appeared"
await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ id: 1 }));

// waitForElementToBeRemoved — for disappearance
await waitForElementToBeRemoved(() => screen.queryByText(/loading/i));
```

Prefer `findBy` over `waitFor(() => getBy…)` — same behaviour, better failure messages.

### The `act` warning

```
Warning: An update to Component inside a test was not wrapped in act(...)
```

It means state updated outside React's batching — almost always an un-awaited async operation. The fix is nearly never to wrap things in `act()` manually; it's to await the thing you forgot:

```jsx
await user.click(button);                       // userEvent wraps in act for you
expect(await screen.findByText('Done')).toBeInTheDocument();
```

---

## 6. Mocking the network with MSW

Mocking `fetch` directly couples tests to your implementation. **Mock the network, not your code.**

```js
// mocks/handlers.js
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/users/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'Ada Lovelace' })),

  http.post('/api/users', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ id: '99', ...body }, { status: 201 });
  }),
];

// setupTests.js
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Per-test overrides for error paths:

```jsx
test('shows an error when the server fails', async () => {
  server.use(http.get('/api/users/:id', () => new HttpResponse(null, { status: 500 })));

  render(<Profile userId="1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong/i);
});
```

The same handlers work in tests, in Storybook and in the browser during development.

---

## 7. Testing hooks

```jsx
import { renderHook, act } from '@testing-library/react';

test('useCounter increments', () => {
  const { result } = renderHook(() => useCounter(5));
  expect(result.current.count).toBe(5);

  act(() => { result.current.increment(); });
  expect(result.current.count).toBe(6);
});

test('reacts to changing arguments', () => {
  const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
    initialProps: { v: 'a' },
  });
  rerender({ v: 'b' });
  expect(result.current).toBe('a');
  act(() => vi.advanceTimersByTime(100));
  expect(result.current).toBe('b');
});
```

Hooks that need a provider get a wrapper:

```jsx
renderHook(() => useAuth(), { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> });
```

Test hooks directly only when they're shared utilities. For app-specific hooks, testing through the component that uses them gives more confidence.

---

## 8. A custom render with all the providers

Repeating provider setup in 200 tests is how test suites rot.

```jsx
// test-utils.jsx
function AllProviders({ children }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },   // deterministic tests
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThemeProvider>{children}</ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const customRender = (ui, options) => render(ui, { wrapper: AllProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };        // shadow the default export
```

Now every test does `import { render, screen } from '@/test-utils'` and gets the full environment. Note `retry: false` — otherwise a failing-request test waits for three retries.

---

## 9. What to test, and what not to

```
✅ TEST
   • user flows: fill the form → submit → see the confirmation
   • conditional rendering the user can observe
   • all four data states: loading, error, empty, success
   • accessibility: roles, labels, keyboard operation, focus
   • edge cases: empty lists, long text, missing optional fields
   • bug regressions — write the failing test first

❌ DON'T TEST
   • implementation details (state variable names, hook call counts)
   • third-party libraries (React Router works; it has its own tests)
   • styling (use visual regression tools for that)
   • that a mock was called with exactly the internal shape you happen to use
```

**The refactor test:** rewrite the component's internals without changing its behaviour. Every test should still pass. If they don't, they were testing the implementation.

---

## 10. The testing pyramid, in practice

```
        ╱╲          E2E (Playwright / Cypress)
       ╱  ╲         a few critical paths: signup, checkout, the core flow
      ╱────╲        slow, flaky-prone, highest confidence
     ╱      ╲
    ╱ INTEG. ╲      Integration (Testing Library) ← spend most of your time HERE
   ╱          ╲     a component + its children + mocked network
  ╱────────────╲    fast, stable, realistic
 ╱     UNIT     ╲   Unit (Vitest)
╱────────────────╲  pure functions, reducers, formatters, validation
```

React's sweet spot is the middle layer. A test that renders a page component with MSW-mocked APIs, clicks through a real flow and asserts what the user sees gives most of E2E's confidence at a fraction of the cost.

```jsx
// an integration test — the shape to aim for
test('a user can add a todo', async () => {
  const user = userEvent.setup();
  render(<TodoApp />);

  await user.type(screen.getByLabelText(/new todo/i), 'Buy milk');
  await user.click(screen.getByRole('button', { name: /add/i }));

  expect(await screen.findByText('Buy milk')).toBeInTheDocument();
  expect(screen.getByLabelText(/new todo/i)).toHaveValue('');    // the field cleared
});
```

---

## 🧠 Rapid-fire recall

1. State Testing Library's guiding principle and one concrete consequence.
2. What's the query priority order, and why does it matter beyond testing?
3. When do you use `queryBy` instead of `getBy`?
4. Why prefer `userEvent` to `fireEvent`?
5. What does an `act()` warning usually mean, and what's the real fix?
6. Why mock at the network level with MSW rather than mocking `fetch` or your API module?
7. Give the "refactor test" for whether a test is good.

<details>
<summary>Answers</summary>

1. The more tests resemble how the software is used, the more confidence they give. Consequently you query by role and label rather than by class or test id, and you assert on what's rendered rather than on internal state.
2. Role → label → placeholder → text → display value, then alt/title, then test id last. It matters because if you can't find something by role or label, real assistive technology probably can't either — the test surfaces an accessibility bug.
3. When asserting that something is *absent*. `getBy` throws when it finds nothing, so the assertion never runs.
4. `userEvent` dispatches the full realistic sequence of events (pointer, focus, key events per character), so it catches handlers and states that a single synthetic `fireEvent` misses — including things like clicking a disabled button.
5. That state updated outside React's batching — usually an async operation you didn't await. The fix is to `await` the interaction or use `findBy`, not to wrap code in `act()` manually.
6. Because it's implementation-independent: the same handlers work whether you use `fetch`, axios or React Query, and they exercise your real request-building and response-parsing code.
7. Rewrite the component's internals without changing its observable behaviour. Every test should still pass; any that fails was testing implementation details.

</details>
