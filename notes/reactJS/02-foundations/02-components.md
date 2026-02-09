# Some React Jargons

## **Component**

import C from '@site/src/components/Color';
import H from '@site/src/components/Highlight';

A **component** is the building block of a React application. It is a <H>self-contained, reusable piece of UI</H> that can be either a **functional** or **class-based** component.

### **Types of Components**

#### 1. **Functional Component**
    - A JavaScript function that takes props as an argument and returns JSX.
    - Introduced in React 16.8, **hooks** allow functional components to manage state and lifecycle features.
    
    ```jsx
    function Greeting(props) {
        return <h1>Hello, {props.name}!</h1>;
    }
    
    ```
    
#### 2. **Class Component** *(Rarely used in modern React applications)*
    - A class extending `React.Component`, with a `render()` method that returns JSX.
    
    ```jsx
    class Greeting extends React.Component {
        render() {
            return <h1>Hello, {this.props.name}!</h1>;
        }
    }
    
    ```
    

### **Characteristics of Components**

- <C color="orange">**Reusability:**</C> Can be used multiple times in an application.
- <C color="orange">**Encapsulation:**</C> Each component has its own logic and styling.
- <C color="orange">**Composition:**</C> Components can be nested inside other components.

---
