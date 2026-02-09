## **Understanding DOMs**

In React, there is a virtual DOM and a real DOM.

### **Virtual DOM**

import C from '@site/src/components/Color';
import H from '@site/src/components/Highlight';

- React uses a virtual DOM to optimize updates and improve performance.  The virtual DOM is an <H>in-memory representation</H> of the actual DOM elements. It's a lightweight copy of the real DOM.
- When you make changes to the state of a React component, React creates a new virtual DOM tree representing the updated state.
- React then compares the new virtual DOM with the previous virtual DOM to determine the differences (diffing).
- The differences are used to compute the most efficient way to update the real DOM.

### **Real DOM**

- The real DOM is the actual browser's Document Object Model, representing the structure of the HTML document.
- When React determines the updates needed based on the virtual DOM diffing process, it updates the real DOM with only the necessary changes.
- Manipulating the real DOM can be expensive in terms of performance, so React aims to minimize direct interaction with it.
