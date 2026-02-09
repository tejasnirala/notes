# Docker Learning Notes

Welcome to my personal notes on Docker. This section covers the core concepts, architecture, and practical commands needed to containerize applications effectively.


## 🐳 What is Docker?

Docker is a platform for developing, shipping, and running applications. It enables you to separate your applications from your infrastructure so you can deliver software quickly. With Docker, you can manage your infrastructure in the same ways you manage your applications.

## 📚 Topics Covered

Here is an index of the available notes in this section:

### 1. Core Concepts

- **[Docker Fundamentals](./docker-fundamentals)**
  - Difference between **Images** vs **Containers**.
  - How to use **Multistage Builds** for efficient image creation.

### 2. Data Management

- **[Mounts & Volumes](./mounts-and-volumes)**
  - Understanding **Volume Mounts** for data persistence.
  - Using **Bind Mounts** for hot-reloading during development.

### 3. Orchestration

- **[Docker Compose](./docker-compose)**
  - Introduction to multi-container networking.
  - Defining services, networks, and volumes.
- **[Compose Instructions Reference](./compose-instructions)**
  - A handy reference for `docker-compose.yml` keywords (`version`, `services`, `ports`, `depends_on`, etc.).

### 4. References

- **[Commands Cheat Sheet](./commands)**
  - Quick lookup for essential CLI commands (`build`, `run`, `exec`, `network`, `volume`).

---

> _These notes are continuously updated as I explore more advanced Docker topics._
