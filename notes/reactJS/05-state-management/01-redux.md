## React Redux

> React-Redux is a library that helps React applications interact with a Redux store. It acts as a binding layer between React and Redux, enabling components to read data from the store and dispatch actions to update the state.
> 

Here’s how it works step by step:

1. **Store Setup**:
    - First, we create a Redux store using the `configureStore` method which holds the **entire global state** of the application.
2. **Provider Component**:
    - We wrap our root component with the redux’s `<Provider>` component from `react-redux`.
    - This gives all nested components access to the Redux store via React’s Context API.
3. **Accessing State with `useSelector`**:
    - Inside any component, we can use the `useSelector` hook to **read** specific parts of the state from the store.
    - This hook automatically subscribes the component to the Redux store, and will cause the component to re-render if the selected state changes.
4. **Dispatching Actions with `useDispatch`**:
    - To update the state, we use the `useDispatch` hook to **send actions** to the store.
    - These actions are handled by **reducers**, which define how the state should change.
5. **Reducers & State Update**:
    - Reducers are pure functions that take the current state and an action, and return a new state.
    - React-Redux ensures that any component using `useSelector` will automatically update when the relevant part of the state changes.
6. **Efficient Rendering**:
    - React-Redux optimizes re-renders by doing shallow comparisons and only re-rendering components whose selected state has changed.
