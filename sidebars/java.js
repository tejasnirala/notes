// @ts-check

/**
 * Java sidebar — a learning path rather than a flat file list.
 *
 * Doc IDs omit the numeric filename prefix (Docusaurus strips `NN-`),
 * so `07-strings.md` has the id `strings`.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  javaSidebar: [
    {
      type: "category",
      label: "Java",
      link: {
        type: "doc",
        id: "index",
      },
      collapsed: false,
      items: [
        {
          type: "category",
          label: "Foundations",
          link: {
            type: "generated-index",
            title: "Foundations",
            description:
              "How the runtime actually works — bytecode, the JVM, memory and garbage collection — then every piece of the language you need before objects: types, operators, control flow, arrays, methods and strings.",
            slug: "/foundations",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "how-java-works", label: "How Java Works" },
            {
              type: "doc",
              id: "variables-and-data-types",
              label: "Variables, Data Types & Literals",
            },
            { type: "doc", id: "operators", label: "Operators" },
            { type: "doc", id: "control-flow", label: "Control Flow" },
            { type: "doc", id: "arrays", label: "Arrays" },
            {
              type: "doc",
              id: "methods-and-overloading",
              label: "Methods & Overloading",
            },
            { type: "doc", id: "strings", label: "Strings" },
          ],
        },
        {
          type: "category",
          label: "Object-Oriented Java",
          link: {
            type: "generated-index",
            title: "Object-Oriented Java",
            description:
              "The four pillars, and every mechanism that implements them: constructors and initialization order, static members, dynamic dispatch, abstract classes, interfaces, final, access control, equals/hashCode, and nested classes.",
            slug: "/oop",
          },
          collapsed: false,
          items: [
            {
              type: "doc",
              id: "classes-and-objects",
              label: "Classes, Objects & Constructors",
            },
            { type: "doc", id: "static-members", label: "Static in Java" },
            { type: "doc", id: "pillars-of-oop", label: "The Four Pillars of OOP" },
            {
              type: "doc",
              id: "inheritance-and-polymorphism",
              label: "Inheritance & Dynamic Dispatch",
            },
            { type: "doc", id: "abstract-classes", label: "Abstract Classes" },
            { type: "doc", id: "interfaces", label: "Interfaces" },
            { type: "doc", id: "final-keyword", label: "The final Keyword" },
            {
              type: "doc",
              id: "packages-and-access-modifiers",
              label: "Packages & Access Modifiers",
            },
            {
              type: "doc",
              id: "object-class",
              label: "The Object Class (equals & hashCode)",
            },
            {
              type: "doc",
              id: "inner-and-anonymous-classes",
              label: "Inner & Anonymous Classes",
            },
          ],
        },
        {
          type: "category",
          label: "Modern Language Features",
          link: {
            type: "generated-index",
            title: "Modern Language Features",
            description:
              "Enums, records, sealed types and var — the features that removed most of Java's boilerplate reputation, plus the pattern matching they unlock.",
            slug: "/modern-features",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "enums", label: "Enums" },
            { type: "doc", id: "records", label: "Records" },
            { type: "doc", id: "sealed-classes", label: "Sealed Classes" },
            { type: "doc", id: "var-type-inference", label: "var — Type Inference" },
          ],
        },
        {
          type: "category",
          label: "Robustness",
          link: {
            type: "generated-index",
            title: "Robustness",
            description:
              "Exception handling done properly, and generics from wildcards to type erasure.",
            slug: "/robustness",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "exceptions", label: "Exception Handling" },
            { type: "doc", id: "generics", label: "Generics" },
          ],
        },
        {
          type: "category",
          label: "Collections",
          link: {
            type: "generated-index",
            title: "Collections",
            description:
              "The whole framework — how to choose an implementation, how HashMap works internally, ordering with Comparable and Comparator, and every way to iterate.",
            slug: "/collections",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "collections-framework",
              label: "The Collections Framework",
            },
            { type: "doc", id: "lists", label: "Lists & ArrayList" },
            { type: "doc", id: "sets", label: "Sets" },
            { type: "doc", id: "maps", label: "Maps" },
            {
              type: "doc",
              id: "comparable-and-comparator",
              label: "Comparable & Comparator",
            },
            {
              type: "doc",
              id: "foreach-and-iteration",
              label: "forEach & Iteration",
            },
          ],
        },
        {
          type: "category",
          label: "Functional Java",
          link: {
            type: "generated-index",
            title: "Functional Java",
            description:
              "Lambdas, the functional interfaces they target, method references, the Stream API traced operation by operation, and Optional.",
            slug: "/functional",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "lambdas", label: "Lambda Expressions" },
            {
              type: "doc",
              id: "functional-interfaces",
              label: "Functional Interfaces & Method References",
            },
            { type: "doc", id: "stream-api", label: "Stream API" },
            {
              type: "doc",
              id: "map-filter-reduce-sorted",
              label: "map, filter, reduce & sorted",
            },
            { type: "doc", id: "optional", label: "Optional" },
          ],
        },
        {
          type: "category",
          label: "Concurrency",
          link: {
            type: "generated-index",
            title: "Concurrency",
            description:
              "Threads and their states, why Runnable beats extending Thread, what actually causes race conditions and how each fix works, then executors, CompletableFuture and virtual threads.",
            slug: "/concurrency",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "threads", label: "Threads & Multithreading" },
            { type: "doc", id: "thread-states", label: "Thread States" },
            { type: "doc", id: "runnable-vs-thread", label: "Runnable vs Thread" },
            { type: "doc", id: "race-conditions", label: "Race Conditions" },
            {
              type: "doc",
              id: "executors-and-futures",
              label: "Executors, Futures & Modern Concurrency",
            },
          ],
        },
      ],
    },
  ],
};

export default sidebars;
