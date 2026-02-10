---
id: rendering-strategies-index
title: Rendering Strategies
sidebar_label: Overview
description: In-depth guide to modern web rendering strategies (CSR, SSR, SSG, ISR).
slug: /csr-ssr-isr-ssg
---

# Rendering Strategies

Modern web development offers several ways to render content. Choosing the right strategy is critical for performance, SEO, and user experience.

This section covers the core rendering patterns used in modern frameworks like React, Next.js, and others.

## Core Concepts

We will explore the following strategies in detail:

### 1. [Client-Side Rendering (CSR)](./csr)

The browser downloads an empty HTML shell and JavaScript bundle. The JavaScript executes to fetch data and build the UI.

- **Best for:** Highly interactive dashboards, private apps behind authentication.
- **Trade-off:** Slower initial load, poor SEO without optimization.

### 2. [Server-Side Rendering (SSR)](./ssr)

The server generates the full HTML for a page on every request.

- **Best for:** Dynamic content that changes frequently and needs SEO / social sharing.
- **Trade-off:** Higher server load, slower time-to-first-byte (TTFB).

### 3. [Static Site Generation (SSG)](./ssg)

Pages are pre-rendered into static HTML at build time.

- **Best for:** Blogs, documentation, marketing pages (content that doesn't change often).
- **Trade-off:** Long build times for large sites, content can be stale.

### 4. [Incremental Static Regeneration (ISR)](./isr)

Allows you to update static pages after you’ve built your site. You can create or update static pages _per-page_, without rebuilding the entire site.

- **Best for:** Large e-commerce sites, news sites where content needs to be mostly static but updated periodically.
- **Trade-off:** Complexity in caching and revalidation logic.

## Comparison at a Glance

| Feature            | CSR               | SSR              | SSG                 | ISR                           |
| :----------------- | :---------------- | :--------------- | :------------------ | :---------------------------- |
| **Rendering Time** | Runtime (Browser) | Runtime (Server) | Build Time          | Build Time + Runtime (Server) |
| **SEO**            | Poor (by default) | Excellent        | Excellent           | Excellent                     |
| **Initial Load**   | Slow              | Fast             | Fast                | Fast                          |
| **Data Freshness** | Real-time         | Real-time        | Stale until rebuild | Fresh (after revalidation)    |
| **Server Cost**    | Low               | High             | Low (CDN)           | Low (CDN + minimal rendering) |

---

Explore each section to understand the implementation, pros, cons, and use cases.
