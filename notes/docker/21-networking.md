---
title: Docker Networking
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Docker Networking

> **What you will be able to do after this page**
>
> - Explain what a network namespace gives each container, and how the bridge connects them.
> - Say precisely what `localhost` means inside a container — the single most common Docker bug.
> - Use embedded DNS and service names instead of IP addresses, and say why.
> - Publish ports deliberately, and know which services should not be published at all.

---

## 1. Each container has its own network stack

A container gets its own **network namespace**: its own interfaces, routing table, firewall rules, port space — and <H>its own loopback interface</H>.

```text
   HOST
   ┌───────────────────────────────────────────────────────────────┐
   │  eth0 203.0.113.10                                            │
   │                                                               │
   │  docker0 / br-xxxx  172.18.0.1        ← the bridge (a virtual │
   │      │      │      │                     switch)              │
   │   veth   veth   veth                                          │
   │      │      │      │                                          │
   │  ┌───┴──┐┌──┴───┐┌─┴────┐                                     │
   │  │ api  ││  db  ││cache │   each: own eth0, own lo, own ports │
   │  │.0.2  ││ .0.3 ││ .0.4 │                                     │
   │  └──────┘└──────┘└──────┘                                     │
   └───────────────────────────────────────────────────────────────┘
```

Each container is connected to the bridge by a **veth pair** — a virtual cable with one end inside the container (`eth0`) and one end on the host attached to the bridge. The bridge switches traffic between them.

Because each container has its own port space, <C color="green">three containers can all listen on port 8080 with no conflict</C>. Conflicts only appear when publishing to the same host port.

---

## 2. Network drivers

| Driver | Use | Notes |
| :--- | :--- | :--- |
| **bridge** | Default for standalone containers and Compose | Isolated virtual network; DNS on user-defined bridges |
| **host** | Container shares the host's network namespace | No isolation, no port mapping, no DNS names; Linux only |
| **none** | No networking at all | For fully isolated batch work |
| **overlay** | Multi-host networking (Swarm) | Encapsulates traffic between hosts |
| **macvlan** | Container gets its own MAC/IP on the physical LAN | For appliances and legacy integration |

### Default bridge vs user-defined bridge

This distinction causes real confusion:

| | Default `bridge` | User-defined bridge |
| :--- | :--- | :--- |
| Automatic DNS by container name | <C color="crimson">No</C> | <C color="green">Yes</C> |
| Isolation from other networks | Weak — everything shares it | Yes, per network |
| Attach/detach a running container | No | Yes |

<H>Always create a user-defined network</H> (or let Compose do it, which is exactly what it does). Name-based service discovery only works there.

```bash
docker network create app-net
docker run -d --name database --network app-net <database-image>
docker run -d --name api      --network app-net -p 8080:8080 myorg/api
# api can now reach the database at the hostname `database`
```

---

## 3. `localhost` inside a container

<H>`localhost` means "this network namespace". Inside a container, that is the container itself — never the host, never another container.</H>

```text
   ❌ MISCONCEPTION                       ✅ REALITY
   ───────────────────                    ───────────────────
   api container:                         api container:
     connect to localhost:5432              localhost:5432 = the api container's
     "reaches the database container"       own loopback → connection refused,
                                            because nothing in THIS container
                                            listens on 5432
```

The error is almost always `ECONNREFUSED` / `connection refused`, and it is a *correct* answer: the container looked at its own loopback and found nothing there.

The fixes, by direction:

| From → To | Address to use |
| :--- | :--- |
| Container → another container (same network) | The other container's **name** or Compose **service name**: `database:5432` |
| Container → itself | `localhost` — correct here, and only here |
| Host → container | `localhost:<published-host-port>`, which requires `-p` |
| Container → a service on the host | `host.docker.internal` (Docker Desktop; on Linux add `--add-host=host.docker.internal:host-gateway`), or the bridge gateway IP |
| Container → the internet | Normal DNS and routing; NAT through the host |

The related trap, worth repeating from [Runtime Configuration](./14-runtime-configuration.md): a process that **binds** to `127.0.0.1` inside a container is unreachable from outside it, even with `-p 8080:8080`, because published traffic arrives on the container's `eth0`, not its loopback. <C color="crimson">Bind to `0.0.0.0`.</C> "It works locally but not in Docker" is this bug about half the time.

---

## 4. Service discovery and DNS

On a user-defined network, Docker runs an **embedded DNS server** at `127.0.0.11` inside each container. It resolves container names, network aliases and — under Compose — service names.

```text
   api container:  getaddrinfo("database")
        → 127.0.0.11 (Docker's embedded DNS)
        → 172.18.0.3
```

Names not matching a container are forwarded to the host's configured resolvers, so external DNS keeps working.

### Why you must not hardcode container IPs

- They are assigned from the network's pool at start and <H>change whenever a container is recreated</H> — every deploy, every `compose up` after a rebuild.
- The order containers start in affects who gets which address.
- They are meaningless outside that network.
- Names are stable, self-documenting, and identical across environments.

```yaml
    environment:
      DATABASE_URL: postgres://app@database:5432/app   # ✅ service name
      # DATABASE_URL: postgres://app@172.18.0.3:5432/app  ❌ breaks on the next recreate
```

**Aliases and scaling:** a service can have extra DNS names (`networks.<net>.aliases`), and when a Compose service is scaled to several replicas, its name resolves to *multiple* A records. Simple round-robin comes from the resolver returning them in varying order — which is load distribution, not load balancing: no health awareness, and client-side DNS caching frequently defeats it. Use a real proxy or an orchestrator's service abstraction when it matters.

---

## 5. Publishing ports

```text
   -p 8080:80
      │    └── CONTAINER port — where the app listens
      └─────── HOST port — where clients connect

   -p 127.0.0.1:8080:80    bind only to host loopback (not reachable externally)
   -p 8080:80/udp          protocol
   -P                      publish every EXPOSEd port to random host ports
```

Publishing installs a NAT rule (DNAT via iptables/nftables) on the host that forwards traffic to the container's IP and port.

```text
   client → host:8080 ──DNAT──► 172.18.0.2:80 (container)
```

`EXPOSE` in a Dockerfile does none of this — it is documentation only. See [Dockerfile §9](./05-dockerfile.md#9-expose).

**Containers on the same network do not need published ports to talk to each other.** Publishing is exclusively about reaching a container *from the host or outside world*.

```yaml
services:
  api:
    ports:
      - "8080:8080"        # ✅ the entry point; must be reachable
  database:
    # no ports! the api reaches it at database:5432 over the internal network
  cache:
    # likewise
```

<H>Publishing a database port in production exposes it to anything that can reach the host.</H> A frequent and serious misconfiguration. If you need local access for debugging, bind it to loopback only:

```yaml
    ports:
      - "127.0.0.1:5432:5432"
```

Note one surprise on Linux: Docker's published-port rules are inserted in a way that can bypass a host firewall's INPUT rules, so a service you believed was firewalled may in fact be reachable. Check with `iptables -L DOCKER -n` and prefer binding to loopback for anything not meant to be public.

---

## 6. Multiple networks and segmentation

A container can be attached to several networks — the basis of tiered architectures:

```yaml
services:
  proxy:
    networks: [frontend]
    ports: ["443:443"]
  api:
    networks: [frontend, backend]     # bridges the two tiers
  database:
    networks: [backend]               # unreachable from the frontend network

networks:
  frontend:
  backend:
    internal: true      # no outbound access to the wider world
```

```text
   internet ──► proxy ──[frontend]──► api ──[backend]──► database
                                                          ▲
                              nothing on `frontend` can reach here
```

`internal: true` removes external connectivity from a network entirely — a strong control for data tiers.

---

## 7. Debugging

```bash
docker network ls                              # what networks exist
docker network inspect app-net                 # subnet, gateway, attached containers + IPs
docker inspect <container> --format '{{json .NetworkSettings.Networks}}'
docker exec <c> getent hosts database          # does the name resolve?
docker exec <c> nc -zv database 5432           # is the port reachable?
docker port <container>                        # what is published
```

A reliable diagnostic ladder:

```text
 1. Are both containers on the SAME user-defined network?   → docker network inspect
 2. Does the name resolve?                                  → getent hosts <service>
 3. Is the port open on the target?                         → nc -zv <service> <port>
 4. Is the app bound to 0.0.0.0, not 127.0.0.1?             → check its config
 5. Is it the app that is failing, not the network?         → docker logs
```

Note that minimal images may have no networking tools at all — that is the debuggability cost discussed in [Base Images](./12-base-images.md). Attach a temporary container to the same network instead:

```bash
docker run --rm -it --network app-net <image-with-network-tools> sh
```

---

## Rapid-fire recall

1. What does a network namespace give a container?
2. Why can three containers all listen on 8080?
3. What does `localhost` refer to inside a container?
4. A backend can't reach `localhost:5432`, where 5432 is a database container. Diagnose and fix.
5. Why is binding to `127.0.0.1` inside a container a bug even with `-p`?
6. What does a user-defined bridge give you that the default bridge does not?
7. Why must you never hardcode a container IP?
8. Does `EXPOSE` publish a port? Does a database container need published ports to be reachable by the API?
9. What is the risk of publishing a database port, and what is the safer form?
10. What does `internal: true` do to a network?

<details>
<summary>Answers</summary>

1. Its own interfaces, routing table, firewall rules, port space and loopback interface.
2. Each has its own port space; conflicts only arise when publishing to the same host port.
3. The container's own loopback interface — itself, never the host or another container.
4. The backend is looking at its own loopback where nothing listens. Put both on the same user-defined network and connect to `database:5432`.
5. Published traffic is DNAT'd to the container's `eth0` address; a loopback-only listener never sees it. Bind `0.0.0.0`.
6. Automatic DNS resolution of container/service names, proper isolation between networks, and the ability to attach or detach running containers.
7. IPs are assigned from a pool at start and change on every recreate; names are stable and environment-independent.
8. No — `EXPOSE` is documentation. And no — containers on the same network reach each other directly; publishing is only for access from the host or outside.
9. It exposes the database to anything that can reach the host, and Docker's rules may bypass host firewall INPUT rules. Bind to loopback: `127.0.0.1:5432:5432`, or publish nothing.
10. It removes external connectivity for containers attached to it — no outbound access to the wider network.

</details>

---

**Next:** [Docker Compose](./22-compose-fundamentals.md) — declaring a whole application topology in one file.
