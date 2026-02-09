# State

import H from '@site/src/components/Highlight';

**State** is a <H>built-in object</H> in React that allows components <H>to store and manage data dynamically</H>. Changes in state trigger **re-rendering** of the component.

### **Using State in Functional Components**

With React hooks (`useState`), managing state in a functional component is easy:

```jsx
import { useState } from "react";

function Counter() {
    const [count, setCount] = useState(0); // [stateVariable, setterFunction]

    return (
        <div>
            <p>Count: {count}</p>
            <button onClick={() => setCount(count + 1)}>Increment</button>
        </div>
    );
}

```

### **State in Class Components (Legacy Approach)**

Before hooks, state was managed inside class components using `this.state` and `setState()`:

```jsx
class Counter extends React.Component {
    constructor(props) {
        super(props);
        this.state = { count: 0 };
    }

    increment = () => {
        this.setState({ count: this.state.count + 1 });
    };

    render() {
        return (
            <div>
                <p>Count: {this.state.count}</p>
                <button onClick={this.increment}>Increment</button>
            </div>
        );
    }
}

```

### **State Rules in React**

- State should **not** be modified directly (`this.state.count = 10` is incorrect).
- State updates are **asynchronous**, meaning multiple `setState` calls may be batched.
- **Derived state** should be avoided if possible; instead, compute values inside `render()` or functional components.

---
