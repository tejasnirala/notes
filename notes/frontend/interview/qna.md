### Q) Can you walk me through how you’d handle server-side rendering versus client-side rendering in a Next.js project and when you'd choose one over the other?

So in a Next.js project, I usually decide between SSR and CSR based on what the page actually needs.

If the page is something like a public product page or blog post, where SEO matters and I want the user to see content immediately, I’d go with server-side rendering. In that case, the server fetches the data, renders the HTML, and sends a ready-to-view page to the browser.

But if it’s something like a user dashboard or a settings page, where SEO isn’t important and the user is doing a lot of interactions—like filtering, sorting, or updating data—I’d use client-side rendering. The page loads first, and then the browser fetches and updates the data as the user interacts.

In practice, I usually combine both. For example, on a product page, I might render the main product details on the server for SEO, but load things like reviews or related items on the client for better interactivity.

So the decision mostly depends on SEO needs, data freshness, and how interactive the page is.

---

### Q) Let’s say you’re optimizing performance in a React app—what tools or strategies would you use to identify and fix slow components?

I usually follow a **measure-first, then optimize** approach.

First, I use the **React DevTools Profiler** to record interactions and see which components are re-rendering frequently and how long they take. That helps me quickly identify slow or unnecessary re-renders.

Once I find the problem component, I look for the root cause—most often **unnecessary re-renders**. To fix those, I typically use:

* `React.memo` to prevent re-renders when props haven’t changed
* `useMemo` for expensive calculations
* `useCallback` to keep function references stable

If the issue involves **large lists**, I use **list virtualization** with libraries like `react-window` so only visible items render.

I also check for:

* Heavy logic inside render functions
* Excessive state updates
* Global state causing wide re-renders
* Unnecessary data refetching

For overall performance, I may apply:

* **Code-splitting** with `React.lazy` or dynamic imports to reduce bundle size
* **Lazy loading** for heavy components like modals or charts
* **Debouncing** for inputs like search to reduce API calls
* Proper **cleanup in `useEffect`** to avoid memory leaks

So overall: I use the **React Profiler** to find bottlenecks, then fix the root cause—usually unnecessary re-renders, heavy computations, large lists, or oversized bundles.

---

### Q) What’s your favourite React hook, and why do you think it’s so useful in your projects?

That would probably be **`useEffect`**, mainly because of how often it’s used and how important it is for handling real-world application logic.

In most React apps, components don’t just render static data—they need to **fetch data, set up subscriptions, listen to events, or interact with APIs**. `useEffect` is the hook that lets us handle those side effects in a clean and controlled way.

For example, a very common case is **fetching data when a component loads**. Instead of mixing that logic directly into the render, I can use `useEffect` to trigger the API call after the component mounts. It keeps the component logic more predictable and easier to manage.

Another reason I find it useful is the **dependency array**. It gives precise control over when the effect should run. So if I only want to refetch data when a specific filter or ID changes, I can just put that value in the dependency array.

I also like that `useEffect` supports **cleanup functions**. That becomes really important when working with things like event listeners, intervals, or subscriptions. It helps prevent memory leaks and unexpected behavior when components unmount.

So overall, I use `useEffect` in almost every feature—whether it’s for data fetching, syncing state with APIs, or handling side effects. Because of that, it ends up being the hook I rely on the most in day-to-day development.

---

### Q) Let’s say you’re building a large e-commerce site in Next.js. You have thousands of product pages. How would you balance static generation, incremental static regeneration, and dynamic server-side rendering for the best performance and user experience?

In that kind of scenario, I wouldn’t use just one rendering strategy. With thousands of product pages, the goal is to **keep the site fast, SEO-friendly, and still handle frequently changing data**, so I’d usually combine **SSG, ISR, and SSR** based on the type of content.

For the majority of product pages, I’d use **static generation with ISR**. At build time, I’d only pre-render the **most popular or high-traffic products**. This keeps the build time reasonable. Then for the rest of the products, I’d rely on **on-demand generation** with ISR.

So when a user visits a product page that wasn’t pre-built, Next.js would generate it on the first request, cache it, and then serve the static version after that. I’d also set a **revalidation time**, so the page automatically updates every few minutes or hours, depending on how often the product data changes.

For example, if product prices or stock levels change often, I might set a shorter revalidation window. But for products that rarely change, I’d keep a longer interval to reduce server work.

Now, for cases where the data must be **real-time or user-specific**, I’d use **server-side rendering**. A good example is:

* Cart page
* Checkout
* Personalized recommendations
* Pages showing user-specific discounts

Those pages depend on the logged-in user and can’t really be cached globally, so SSR makes more sense there.

So the general balance would look like this:

* **SSG (at build time):** Top-selling or featured products.
* **ISR:** The rest of the product catalog, with a suitable revalidation interval.
* **SSR:** User-specific or real-time pages like cart, checkout, and account sections.

This way, most of the site is served as **fast static content**, the catalog stays reasonably fresh through ISR, and only the parts that truly need it use SSR. That gives a good balance between performance, scalability, and user experience.

---

### Q) How would you handle global state management in a React app? And if you were using Next.js, would your approach change at all, and why?

In a React app, how I handle global state mostly depends on **how complex the state is** and **how widely it’s used** across the application.

If the state is fairly simple—like theme, authentication status, or a small set of shared values—I usually start with **React Context** combined with `useReducer` or `useState`. It keeps things simple and avoids bringing in an extra library too early. For example, things like user info, dark mode, or a small cart state can be handled easily with a context provider at the root of the app.

But if the application grows and the state becomes more complex—like a large e-commerce cart, filters, caching, or multiple interconnected features—then I’d usually move to a more structured solution like **Redux Toolkit** or a lightweight store like **Zustand**. These tools make it easier to manage complex updates, debugging, and separation of concerns.

I also try to be careful about **what actually needs to be global**. Not everything should go into global state. For example, form inputs, modal toggles, or component-specific data usually stay in **local component state**.



If I’m using **Next.js**, the core idea doesn’t really change, but there are a few extra considerations because of **server-side rendering**.

In Next.js, the app can render on the server, so I have to make sure:

* The global state is **safe to run on both server and client**.
* I don’t accidentally **share state between users** on the server.

So instead of using a single global store instance, I usually create the store **per request** when SSR is involved. Many libraries, like Redux Toolkit, have patterns for this in Next.js.

Another difference is that in Next.js, I try to **avoid putting server-fetched data into global state** unless it’s truly needed across the app. Often, it’s better to:

* Fetch data on the server for a page.
* Pass it as props.
* Let the page manage it locally or with a data-fetching library.

So in a typical Next.js app:

* **Auth state, theme, or cart** → global state.
* **Page-specific data** → fetched on the server or via client data-fetching, not always global.



So overall, the approach is similar in both React and Next.js.
I start simple with Context, move to a state library if complexity grows, and in Next.js I just pay extra attention to **SSR safety and per-request state isolation**.

---

### Q) In React, how do you avoid unnecessary re-renders, especially when passing functions or objects down to child components? What techniques or hooks would you use to optimize that?

Yeah, unnecessary re-renders usually happen in React when **props change by reference**, especially with functions or objects, even if their actual values haven’t changed.

So when I’m dealing with that, the first thing I do is check whether the re-renders are actually a problem. If they are, I usually start by wrapping the child component with **`React.memo`**. That way, the component only re-renders when its props actually change.

But then there’s the common issue with **functions and objects**. Since React creates new references on every render, even something like an inline function can cause the child to re-render.

For functions, I usually use **`useCallback`**.
So instead of passing a new function every render, I memoize it. For example, if I’m passing a click handler to a child component, I’d wrap it in `useCallback` with the right dependencies. That way, the function reference stays stable unless something important changes.

For objects or computed values, I use **`useMemo`**.
Let’s say I’m creating a configuration object or filtering a list before passing it to a child. Without `useMemo`, that object is recreated on every render, which can trigger unnecessary updates. With `useMemo`, the value is only recalculated when its dependencies change.

Another thing I pay attention to is **where the state lives**.
If state is too high up in the component tree, it can cause a lot of unrelated components to re-render. So I try to keep state as **close as possible to where it’s actually needed**.

So the usual combination I use is:

* `React.memo` for child components.
* `useCallback` for functions passed as props.
* `useMemo` for objects or expensive calculations.
* Proper state placement to avoid wide re-renders.

That usually helps keep the component tree more stable and improves performance, especially in larger or more interactive parts of the app.

---

### Q) Imagine a parent component with lots of children updating frequently. How would you use React’s built-in tools to profile and identify which child might be the bottleneck, and how would you fix it?


If I run into a situation where a parent has a lot of children and the UI feels slow, the first thing I do is **confirm where the slowdown is**, instead of guessing.

I usually start with the **React DevTools Profiler**. I open the app, go to the Profiler tab, start recording, and then perform the interaction that feels slow—like typing in a search box, clicking filters, or updating a form.

Once I stop the recording, the profiler shows a **flame graph** of the component tree. There, I look for:

* Components with **long render times**.
* Components that are **re-rendering too often**.

Sometimes I’ll notice something like a list of items where every child component re-renders whenever the parent state changes, even though most of those items didn’t actually change. That’s usually the bottleneck.

After identifying the problematic child, I check **why it’s re-rendering**. The common causes are:

* The parent passing new function references on every render.
* Objects or arrays being recreated each time.
* State being lifted too high in the component tree.

To fix it, I usually start by wrapping the slow child component in **`React.memo`** so it only re-renders when its props actually change.

Then I stabilize the props coming from the parent:

* If I’m passing a function, I wrap it in **`useCallback`**.
* If I’m passing a computed object or array, I use **`useMemo`**.

If the issue is that the parent state is causing too many children to update, I might also **move the state closer** to the components that actually use it, so fewer components re-render.

After making the changes, I go back to the **React Profiler** and record the interaction again to confirm that:

* The slow component renders less often.
* The overall render time has improved.

So the process is basically:
**Profile → identify the slow component → find the cause → apply memoization or better state placement → re-profile to verify the improvement.**

---

### Q) Imagine you have a form-heavy application. How would you handle form state and validation in a performant, clean way in a React or Next.js app?

In a form-heavy application, my main goal is to keep the form logic **clean, scalable, and performant**, especially when there are many fields or complex validations.

If I try to manage everything with plain `useState`, it quickly becomes messy. Every input change causes the parent component to re-render, and with large forms that can affect performance and readability.

So in most cases, I use a library like **React Hook Form**.

The reason I prefer React Hook Form is that it uses **uncontrolled components under the hood**, so it doesn’t trigger a re-render on every keystroke. Only the fields that actually change or have validation issues re-render. That makes it much more performant, especially for large or dynamic forms.

For validation, I usually integrate it with a schema library like **Zod** or **Yup**. That way, the validation rules are defined in one place, and they’re easier to maintain and reuse. It also keeps the component code cleaner, because the validation logic isn’t scattered across multiple handlers.

So the general approach would be:

* Use **React Hook Form** to manage form state.
* Define validation rules using a schema like Zod.
* Connect the schema to the form using a resolver.
* Keep each input as a separate component when the form grows large.

This keeps the form:

* Performant, because of minimal re-renders.
* Clean, because logic is centralized.
* Scalable, because adding new fields or validations is straightforward.

If I’m using **Next.js**, the approach doesn’t really change on the client side. I still use React Hook Form for the UI. The main difference is how I handle submissions.

For example, in Next.js I might:

* Submit the form to an **API route** or server action.
* Validate again on the server for security.
* Return structured errors if needed.

So overall, I rely on **React Hook Form + schema-based validation**, and in Next.js I just integrate that with server-side handling for a complete, secure flow.

---

### Q) Imagine you need internationalization (i18n) in a Next.js app. How would you set up multi-language routing and ensure different pages are rendered in the user’s chosen language?

In a Next.js app, I’d approach internationalization in two parts: **routing** and **content translation**.

First, for multi-language routing, Next.js has built-in i18n support. I’d configure the `next.config.js` with the supported locales, for example:

* `en`
* `fr`
* `de`

and define a default locale. Once that’s set up, Next.js automatically handles routes like:

* `/en/products`
* `/fr/products`

So routing becomes locale-aware without me manually creating separate folders for each language.

Now for the actual translations, I usually use a library like **next-i18next** or another i18n solution that works well with Next.js. I’d store translation files in a structure like:

```
public/locales/en/common.json
public/locales/fr/common.json
```

Then inside components, instead of hardcoding text, I’d use a translation hook like `t('button.submit')`. That way, based on the current locale, the correct string is loaded.

For server-side rendering or static generation, I make sure that translations are loaded during the page rendering phase. That way:

* If it’s SSR, the server renders the page already translated.
* If it’s SSG or ISR, the page is pre-generated per locale.

This ensures SEO works properly for each language, since each locale has its own route and fully rendered content.

For language switching, I’d use Next.js router to change the locale while preserving the current path. For example, if the user is on `/en/products`, switching to French would take them to `/fr/products`.

One important thing I pay attention to is making sure:

* URLs are consistent and indexable.
* There’s no mixing of languages in one page.
* The selected locale is stored properly, either in the URL or cookies.

So overall, I rely on Next.js built-in i18n routing for structure, a translation library for content management, and make sure each page is rendered fully in the selected language, whether through SSR or static generation.

---

### Q) In React, why is it recommended to keep components pure and avoid directly mutating state? How does React’s reconciliation rely on immutability, and what might go wrong if you don’t follow that pattern?

That’s a really important concept in React.

React recommends keeping components pure and avoiding direct state mutation because React’s rendering model is built around **predictability and comparison**.

A “pure” component, in simple terms, means:

* Given the same props and state, it should return the same UI.
* It shouldn’t cause side effects during rendering.

Now, regarding immutability — React’s reconciliation process relies heavily on **shallow comparison**. When state updates, React compares the previous state and the new state by reference. If the reference changes, React knows something changed and triggers a re-render.

For example, if I have:

```js
const [user, setUser] = useState({ name: "Tejas" });
```

If I mutate it directly like:

```js
user.name = "John";
setUser(user);
```

The object reference hasn’t changed. It’s still the same object in memory. So React might not detect a change properly, especially in cases where memoization or `React.memo` is involved.

But if I do:

```js
setUser({ ...user, name: "John" });
```

Now I’m creating a new object. The reference changes. React can clearly detect that something changed and re-render accordingly.

If we don’t follow immutability:

1. React may not re-render when it should.
2. Memoized components (`React.memo`) may fail to update.
3. Debugging becomes harder because state changes are unpredictable.
4. It can break optimizations like `useMemo`, `useCallback`, and `shouldComponentUpdate`.

Immutability also makes it easier to reason about state changes. Instead of modifying existing data, we produce a new version of it. That keeps updates predictable and easier to debug.

So overall, React’s reconciliation depends on reference comparison. If we mutate state directly, we break that assumption, and the UI can become inconsistent or behave unexpectedly.

---

### Q) In React, what exactly are closures, and how might they cause bugs in something like a useEffect if not handled carefully?

Closures in React are not a React-specific concept — they’re a **JavaScript concept**.

A closure basically means that a function “remembers” the variables from the scope in which it was created, even after that scope has finished executing.

Now in React, closures become important because **every render creates a new function scope**. So when you define a function or a `useEffect`, it captures the state and props from that specific render.

Here’s where bugs can happen.

Let’s say we have something like:

```js
useEffect(() => {
  const interval = setInterval(() => {
    console.log(count);
  }, 1000);
}, []);
```

If `count` is a state variable, and I leave the dependency array empty, this effect runs only once — on mount. The function inside `setInterval` captures the value of `count` from the **initial render**.

So even if `count` updates later, the interval callback still logs the old value. That’s what we call a **stale closure** — the function is holding onto outdated state.

This can cause subtle bugs like:

* Timers not reflecting updated state
* Event listeners using old values
* API calls using outdated filters or IDs

To fix this, we need to make sure the effect is aware of the values it depends on. So typically, we include `count` in the dependency array:

```js
useEffect(() => {
  const interval = setInterval(() => {
    console.log(count);
  }, 1000);

  return () => clearInterval(interval);
}, [count]);
```

Now, every time `count` changes, the effect re-runs with the latest value.

Another approach in certain cases is using functional state updates:

```js
setCount(prev => prev + 1);
```

This avoids relying on a potentially stale value from the closure.

So in summary:

Closures themselves are normal and expected. But in React, because each render creates a new scope, effects and callbacks can accidentally capture outdated state. If we don’t manage dependencies carefully, we end up with stale closures that cause confusing bugs.

That’s why understanding closures is very important when working with `useEffect`, event handlers, and async logic in React.

---

### Q) Could you explain what React’s concurrent rendering is and how it improves user experience?

Yeah, so React’s concurrent rendering is basically an enhancement to how React schedules and processes updates.

In older versions of React, rendering was mostly **synchronous**. That means once React started rendering an update, it would continue until it finished — even if that blocked the main thread for a noticeable amount of time. If the component tree was large, the UI could feel frozen during heavy updates.

With **concurrent rendering** (introduced in React 18), React can break rendering work into smaller chunks and **pause, resume, or even abandon work** if something more important comes up.

For example, imagine a page with:

* A search input
* A large list that filters as you type

Without concurrency, every keystroke could trigger a heavy re-render of the list, potentially making typing feel laggy.

With concurrent rendering, React can prioritize the input update (which is urgent) and delay the expensive list rendering slightly. That way, typing remains smooth, even if the list takes a bit longer to update.

React exposes this through features like:

* `startTransition`
* `useTransition`
* `useDeferredValue`

For instance, if filtering a list is expensive, I can wrap that state update in `startTransition`. That tells React:
“This update is not urgent — keep the UI responsive first.”

So instead of blocking the user interaction, React schedules lower-priority work in the background.

The main improvements to user experience are:

* Smoother typing and interactions
* Less UI blocking
* Better perceived performance
* More responsive apps under heavy load

It doesn’t necessarily make the app compute faster, but it makes it **feel faster and more responsive**, which is often more important from a UX perspective.

---

### Q) In a React app, if you needed to optimize a list of thousands of items, what techniques would you use to ensure smooth rendering and performance?

If I had to render thousands of items in a React app, the first thing I’d think about is: *“Do I really need to render all of them at once?”*

Because rendering a huge DOM tree is usually the main bottleneck.

The most effective technique I’d use is **list virtualization**. Instead of rendering all 5,000 items, I’d use a library like `react-window` or `react-virtualized` so that only the items currently visible in the viewport are actually mounted in the DOM. As the user scrolls, items are recycled.

That alone usually solves 80–90% of the performance issue.

Next, I’d make sure each list item component is optimized:

* Wrap the item component with `React.memo` so it doesn’t re-render unnecessarily.
* Make sure props passed to it are stable using `useCallback` or `useMemo`.
* Use proper `key` values — stable and unique IDs, not array indexes.

If the list updates frequently (like filtering or sorting), I’d also:

* Debounce user input if filtering is triggered by typing.
* Memoize expensive computations like sorting or filtering using `useMemo`.

If data fetching is involved, I’d avoid loading everything upfront unless necessary. For example:

* Use pagination or infinite scrolling.
* Fetch data in chunks.

And if rendering is still heavy due to complex item UI (like charts or images), I might:

* Lazy-load images.
* Dynamically import heavier components.
* Simplify the DOM structure inside each list item.

So my general strategy is:

1. Reduce the number of DOM nodes with virtualization.
2. Prevent unnecessary re-renders with memoization.
3. Avoid heavy calculations on every render.
4. Limit how much data is loaded at once.

That combination usually keeps even very large lists smooth and responsive.

---



