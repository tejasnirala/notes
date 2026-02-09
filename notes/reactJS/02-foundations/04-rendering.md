# Re-rendering

Updation of any component in UI to reflect changes in state, props, or context is called re-rendering in react.

### What Triggers Re-rendering?

1. **State Change:** When `useState` or `this.setState` updates state, React re-renders the component.
2. **Props Change:** If a parent component passes new props to a child, the child re-renders.
3. **Context Change:** When `useContext` detects changes in a React context, it triggers a re-render.

### Optimizing Re-renders

- **Use `React.memo()`** to prevent unnecessary re-renders of functional components:
    
    ```jsx
    const MemoizedComponent = React.memo(({ count }) => {
        console.log("Rendering...");
        return <p>Count: {count}</p>;
    });
    
    ```
    
- **Use `useCallback()`** to memoize functions so that they don’t trigger re-renders unnecessarily.
- **Use `useEffect()` carefully** to prevent infinite loops due to state updates inside effects.
