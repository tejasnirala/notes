# 🌐 **Document Object Model (DOM)**

## 📌 **What is the DOM?**

The **Document Object Model (DOM)** is a **programming interface** for web documents. It represents the structure of an HTML or XML document as a **tree-like hierarchy** of objects, where each node is an element, attribute, or piece of text.

- **Platform & Language-Independent:** Can be manipulated using languages like JavaScript, Python, etc.
- **Live Representation:** Changes to the DOM reflect immediately on the web page.
- **Tree Structure:** The document is represented as a hierarchical tree of nodes.

---

## 🌳 **DOM Tree Structure**

Consider the following simple HTML document:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
  </head>
  <body>
    <h1>Hello, World!</h1>
    <p>This is a paragraph.</p>
  </body>
</html>

```

### **DOM Tree Representation:**

```
#document
├── html
│   ├── head
│   │   └── title
│   │       └── "My Page"
│   └── body
│       ├── h1
│       │   └── "Hello, World!"
│       └── p
│           └── "This is a paragraph."

```

### **Key Concepts:**

- **Root Node:** The top-level `#document` node.
- **Element Nodes:** Represent HTML tags (e.g., `<html>`, `<body>`, `<p>`).
- **Text Nodes:** Contain the actual text inside the elements (e.g., `"Hello, World!"`).
- **Attribute Nodes:** Store element attributes (e.g., `id`, `class`).

---

## 🚀 **Accessing the DOM with JavaScript**

The DOM is accessed via the **`document`** object in JavaScript.

### ✅ **1. Selecting Elements**

### a) **By ID:**

```jsx
const heading = document.getElementById('main-title');
```

### b) **By Class:**

```jsx
const items = document.getElementsByClassName('item');
```

### c) **By Tag Name:**

```jsx
const paragraphs = document.getElementsByTagName('p');
```

### d) **Using Query Selectors:**

```jsx
const firstParagraph = document.querySelector('p');          // First <p>
const allItems = document.querySelectorAll('.item');         // All items with class 'item'
```

---

## ✍️ **2. Manipulating the DOM**

### a) **Changing Content**

- **Text Content:** Treats the input as plain text.
    
    ```jsx
    const heading = document.querySelector('h1');
    heading.textContent = '<b>Welcome to the DOM!</b>';
    ```
    
- **HTML Content:** Parses any text as HTML.
    
    ```jsx
    const div = document.querySelector('#content');
    div.innerHTML = '<strong>New Content Added!</strong>';
    ```
    

---

### b) **Changing Attributes**

```jsx
const link = document.querySelector('a');
link.setAttribute('href', 'https://example.com');
console.log(link.getAttribute('href')); // Output: https://example.com
link.removeAttribute('target');
```

---

### c) **Manipulating Styles**

```jsx
const box = document.querySelector('.box');
box.style.backgroundColor = 'lightblue';
box.style.fontSize = '20px';
```

---

### d) **Working with Classes**

```jsx
const element = document.querySelector('#myDiv');

// Add, remove, toggle, and check classes
element.classList.add('highlight');
element.classList.remove('hidden');
element.classList.toggle('active');
console.log(element.classList.contains('active')); // true or false
```

---

## ⚡ **3. Creating and Inserting Elements**

### a) **Creating Elements:**

```jsx
const newElement = document.createElement('div');
newElement.textContent = 'I am a new element!';
newElement.classList.add('new-class');
```

### b) **Inserting Elements:**

```jsx
const parent = document.querySelector('#container');

parent.appendChild(newElement);          // Adds at the end
parent.insertBefore(newElement, parent.firstChild); // Adds at the beginning
```

### c) **Removing Elements:**

```jsx
const elementToRemove = document.querySelector('.remove-me');
elementToRemove.remove();
```

---

## 🎯 **4. DOM Events**

The DOM allows handling user interactions via **event listeners**.

### a) **Adding Event Listeners:**

```jsx
const button = document.querySelector('#clickMe');

button.addEventListener('click', function () {
    alert('Button clicked!');
});
```

### b) **Event Types:**

- **Mouse Events:** `click`, `dblclick`, `mouseover`, `mouseout`
- **Keyboard Events:** `keydown`, `keyup`, `keypress`
- **Form Events:** `submit`, `change`, `focus`, `blur`

### c) **Event Object:**

```jsx
button.addEventListener('click', function (event) {
    console.log('Event Type:', event.type);
    console.log('Clicked Element:', event.target);
});
```

---

## 🔄 **5. Event Delegation**

Instead of adding event listeners to multiple child elements, attach one listener to a parent element.

```jsx
document.querySelector('#list').addEventListener('click', function (event) {
    if (event.target.tagName === 'LI') {
        event.target.classList.toggle('completed');
    }
});
```

- **Benefits:** Improves performance, especially with dynamic content.

---

## ⚙️ **6. DOM Traversal**

### a) **Navigating the DOM Tree:**

```jsx
const element = document.querySelector('#child');

// Parent Node
console.log(element.parentNode);

// Child Nodes
console.log(element.childNodes);        // Includes text nodes
console.log(element.children);          // Element nodes only

// Sibling Nodes
console.log(element.previousElementSibling);
console.log(element.nextElementSibling);
```

---

## 🧩 **7. Real-World Example: Interactive To-Do List**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>To-Do List</title>
    <style>
        .completed { text-decoration: line-through; }
    </style>
</head>
<body>
    <h1>To-Do List</h1>
    <input type="text" id="taskInput" placeholder="New task...">
    <button onclick="addTask()">Add</button>
    <ul id="taskList"></ul>

    <script>
        function addTask() {
            const input = document.getElementById('taskInput');
            const taskText = input.value.trim();

            if (taskText !== '') {
                const li = document.createElement('li');
                li.textContent = taskText;

                // Toggle completed class on click
                li.addEventListener('click', () => li.classList.toggle('completed'));

                document.getElementById('taskList').appendChild(li);
                input.value = '';
            }
        }
    </script>
</body>
</html>

```

---

## ✅ **Best Practices for DOM Manipulation**

1. **Minimize Reflows/Repaints:**
    
    Batch DOM updates together to avoid performance issues.
    
2. **Use Event Delegation:**
    
    Attach events to parent elements for dynamic content.
    
3. **Cache DOM References:**
    
    Store references to frequently accessed elements.
    
4. **Avoid `innerHTML` for User Input:**
    
    Prevent XSS attacks by avoiding direct insertion of untrusted data.
    
5. **Optimize for Performance:**
    
    Use `DocumentFragment` when inserting multiple elements.
    

---

## ⚠️ **Common Pitfalls**

- **Unoptimized Event Listeners:** Adding too many listeners can degrade performance.
- **Direct Manipulation Overhead:** Repeated DOM changes are slow compared to virtual DOM approaches (like React).
- **Security Risks:** Improper handling of user input can lead to XSS vulnerabilities.

---

## 🚀 **Conclusion**

The DOM is the backbone of any web page, allowing dynamic manipulation of content, structure, and styles. Mastery of DOM manipulation is key to building interactive, responsive web applications.
