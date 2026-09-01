---
title: Security
author: Tejas Nirala
---

# Security

> **What you will be able to do after this page**
>
> - Explain why an exposed Redis is compromised in minutes, not days.
> - Write ACL rules that give each service exactly the access it needs.
> - Enable TLS and know what it does and does not protect.
> - Recognize Lua sandbox escapes, injection, and the `CONFIG SET` attack chain.

Redis was designed to run on a trusted network behind a firewall. Its defaults reflect that, and its threat model assumes you did the perimeter work. If you did not, the consequences are severe and fast.

---

## 1. The threat model

:::danger[An unprotected Redis on a public IP is compromised in minutes]
Automated scanners sweep port 6379 continuously. An open instance with no password gives an attacker **full control of the process** — and often the host.

The classic attack chain, which still works against misconfigured servers:

```
   1. Connect (no auth required)
   2. CONFIG SET dir /root/.ssh
   3. CONFIG SET dbfilename authorized_keys
   4. SET payload "\n\nssh-rsa AAAAB3... attacker@evil\n\n"
   5. SAVE
   → Redis writes its RDB to /root/.ssh/authorized_keys
   → the attacker SSHes in as root
```

Variants write cron jobs to `/var/spool/cron/`, or load a **malicious module** with `MODULE LOAD` for direct code execution. There are also documented replication-based attacks (`SLAVEOF` pointing at an attacker-controlled "primary" that serves a crafted RDB with a module payload).

Redis has never been compromised here — **the configuration was.** This is the single most exploited misconfiguration in the entire ecosystem, and it is entirely preventable.
:::

---

## 2. Network isolation — the layer that matters most

**Everything else on this page is defence in depth. This is the actual defence.**

```conf
bind 127.0.0.1 -::1            # loopback only (the default)
bind 10.0.1.5                  # or a specific private interface
protected-mode yes             # refuse external connections when there is
                               # no password and no explicit bind
port 6379
```

```
   ✅ Redis on a private subnet, reachable only from your app servers
   ✅ A security group / firewall allowing 6379 from app servers ONLY
   ✅ bind to a private interface, never 0.0.0.0
   ✅ protected-mode yes
   ❌ 0.0.0.0 with a password — a password is not a firewall
   ❌ "it's fine, it's on a VPC" without a security group
```

```bash
# verify what you are actually listening on
ss -tlnp | grep 6379
redis-cli CONFIG GET bind
redis-cli CONFIG GET protected-mode

# from OUTSIDE your network, confirm it is unreachable
nc -zv your-redis-host 6379      # should time out or be refused
```

**Protected mode** is a safety net added in Redis 3.2: if there is no `bind` directive and no password, Redis accepts only loopback connections and returns an explanatory error to anyone else. It has prevented an enormous number of incidents. Never disable it as a "quick fix" — that is exactly the moment you are creating the vulnerability.

---

## 3. Authentication

### The legacy way

```conf
requirepass a-very-long-random-string-not-a-word
```

```bash
redis-cli -a 'password'                # ⚠ visible in ps and shell history
REDISCLI_AUTH='password' redis-cli     # ✅ better
redis-cli
127.0.0.1:6379> AUTH password
```

:::warning[If you use `requirepass`, make it genuinely long]
Redis can process **hundreds of thousands of `AUTH` attempts per second**. There is no rate limiting, no lockout, no delay. A dictionary word or a short password is brute-forced almost instantly.

Use 32+ random characters from a CSPRNG. And prefer ACL users (§4) — `requirepass` is really just "the password for the `default` user".
:::

### ACLs — the modern way (Redis 6+)

ACLs give you **named users with per-command and per-key permissions**. This is what you should be using.

```bash
ACL WHOAMI
ACL LIST
ACL GETUSER alice
ACL SETUSER <username> <rules...>
ACL DELUSER alice
ACL CAT                      # all command categories
ACL CAT dangerous            # commands in a category
ACL GENPASS                  # generate a secure password
ACL USERS
ACL LOG                      # recent authentication/permission failures
ACL LOG RESET
```

#### The rule syntax

```
   on / off               enable / disable the user
   >password              add a password
   <password              remove a password
   #<sha256-hex>          add a password by hash (do this in config files)
   nopass                 allow any password (DANGEROUS)
   resetpass              remove all passwords

   ~pattern               allow keys matching this glob
   %R~pattern             read-only access to these keys   (Redis 7+)
   %W~pattern             write-only access to these keys  (Redis 7+)
   %RW~pattern            same as ~pattern
   allkeys  /  ~*         all keys
   resetkeys              remove all key patterns

   &channel               allow this Pub/Sub channel pattern
   allchannels            all channels
   resetchannels          remove all channel permissions

   +command               allow a command
   -command               deny a command
   +@category             allow a whole category
   -@category             deny a whole category
   +command|subcommand    allow one subcommand (e.g. +config|get)
   allcommands  /  +@all  everything (DANGEROUS)
   nocommands   /  -@all  nothing
```

#### Practical users

```bash
# a read-only cache consumer, restricted to cache keys
ACL SETUSER cache-reader on '>S3cure-P4ss...' \
  ~cache:* \
  +@read +ping +info

# an application user: full access to its own namespace, no admin commands
ACL SETUSER app-api on '>...' \
  ~app:* ~cache:* ~session:* \
  &notifications:* \
  +@all -@admin -@dangerous -flushall -flushdb -keys -config -debug -shutdown

# a metrics scraper
ACL SETUSER monitoring on '>...' \
  ~* \
  +info +ping +client|info +latency +slowlog|get +memory|stats +cluster|info

# a background worker: only the queue keys, only the commands it needs
ACL SETUSER worker on '>...' \
  ~queue:* ~processing:* ~jobs:* \
  +lpush +rpush +blmove +lmove +lrem +llen +xadd +xreadgroup +xack +xautoclaim
```

```bash
# persist ACLs to a dedicated file rather than redis.conf
CONFIG SET aclfile /etc/redis/users.acl
ACL SAVE
ACL LOAD
```

:::tip[The four categories worth knowing]
```bash
ACL CAT dangerous     # FLUSHALL, KEYS, CONFIG, DEBUG, SHUTDOWN, MONITOR,
                      # CLIENT KILL, REPLICAOF, MODULE, SAVE, ACL, MIGRATE
ACL CAT admin         # server administration
ACL CAT write         # everything that mutates
ACL CAT read          # everything that reads
```

`-@dangerous` is the single highest-value ACL rule. It removes exactly the commands used in the attack chain from §1 and the commands that cause accidental outages.

**Start from `-@all` and add what a service needs**, not from `+@all` and subtract. A deny-list will always be incomplete — the next Redis version adds a command you did not think to deny.
:::

```ts
const redis = new Redis({
  host: 'redis.internal',
  port: 6379,
  username: 'app-api',                    // ← the ACL user
  password: process.env.REDIS_PASSWORD,
});
```

```bash
127.0.0.1:6379> ACL LOG
1) 1) "count"      2) (integer) 3
   3) "reason"     4) "command"          # command | key | channel | auth
   5) "context"    6) "toplevel"
   7) "object"     8) "flushall"         # what was attempted
   9) "username"  10) "app-api"
  11) "age-seconds" 12) "12.045"
  13) "client-info" 14) "id=42 addr=… name=api-worker-3 …"
```

**Ship `ACL LOG` to your SIEM.** It is both an intrusion signal and an excellent debugging tool — "why is this service getting NOPERM" is answered instantly.

---

## 4. TLS (Redis 6+)

```conf
tls-port 6379
port 0                                  # ← disable the plaintext port entirely

tls-cert-file /etc/redis/redis.crt
tls-key-file /etc/redis/redis.key
tls-ca-cert-file /etc/redis/ca.crt

tls-auth-clients yes                    # require CLIENT certificates (mTLS)
tls-replication yes                     # encrypt replication traffic
tls-cluster yes                         # encrypt the cluster bus
tls-protocols "TLSv1.2 TLSv1.3"
tls-ciphersuites "TLS_AES_256_GCM_SHA384"
tls-prefer-server-ciphers yes
```

```bash
redis-cli --tls \
  --cert /etc/redis/client.crt \
  --key /etc/redis/client.key \
  --cacert /etc/redis/ca.crt \
  -h redis.internal -p 6379
```

```ts
const redis = new Redis({
  host: 'redis.internal',
  port: 6379,
  username: 'app-api',
  password: process.env.REDIS_PASSWORD,
  tls: {
    ca: fs.readFileSync('/etc/redis/ca.crt'),
    cert: fs.readFileSync('/etc/redis/client.crt'),   // for mTLS
    key: fs.readFileSync('/etc/redis/client.key'),
    servername: 'redis.internal',                      // ← verify the hostname
  },
});
```

:::note[What TLS buys and what it costs]
✅ Encryption in transit — a network observer sees nothing.
✅ Server authentication — you are talking to the real Redis, not a MITM.
✅ With `tls-auth-clients yes`, **client authentication by certificate** — a genuinely strong control, better than a shared password.

❌ It does **not** protect against a compromised client, a leaked password, or a misconfigured ACL.
❌ It is **not** a substitute for network isolation.

Cost: roughly **10–30% throughput**, because Redis must encrypt and decrypt on the same single thread that executes your commands. On a busy instance that is a real budget item. Within a private VPC where the provider already encrypts inter-host traffic, many teams reasonably skip it; across the public internet or for compliance, it is mandatory.
:::

---

## 5. Dangerous commands

```conf
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command KEYS ""
rename-command DEBUG ""
rename-command SHUTDOWN "SHUTDOWN_a8f7d2e1c9b4"
rename-command CONFIG "CONFIG_x7k2m9p1"
rename-command MODULE ""
rename-command MIGRATE ""
rename-command REPLICAOF ""
rename-command SLAVEOF ""
```

Renaming to `""` disables a command entirely; renaming to a secret string leaves it available to operators who know the name.

:::tip[ACLs are better than `rename-command`]
`rename-command` is global and blunt — it affects everyone including your operators, it breaks tooling that expects standard names, it cannot be changed without a restart, and it is deprecated in newer versions.

ACLs are per-user and dynamic:
```bash
ACL SETUSER app on ... -flushall -flushdb -keys -config -debug -module -migrate
ACL SETUSER admin on ... +@all
```
The application literally cannot run `FLUSHALL`; your on-call engineer can. Use `rename-command` only on Redis 5 and older.
:::

---

## 6. Application-level security

### Never build a key from unvalidated user input

```ts
// ❌ the user controls the key namespace
const key = `user:${req.params.id}`;
//   id = "1:admin"           → collides with another namespace
//   id = <a 10 MB string>    → memory exhaustion, one key at a time
//   id = "*"                 → harmless in GET, dangerous if it reaches a
//                              pattern-matching path

// ✅ validate the shape, and bound the length
const id = String(req.params.id);
if (!/^[0-9]{1,12}$/.test(id)) throw new BadRequest('invalid id');
const key = `user:${id}`;

// ✅ or hash anything free-form
import { createHash } from 'node:crypto';
const key = `user:email:${createHash('sha256').update(email).digest('hex')}`;
```

Hashing free-form input also keeps **PII out of your keys** — which matters because key names appear in `MONITOR`, in the `SLOWLOG`, in `ACL LOG`, in `CLIENT LIST`, and in the RDB file you just uploaded to S3.

### Lua injection

```ts
// ❌ string-concatenating user input into a script is code injection
await redis.eval(`return redis.call('GET', '${userInput}')`, 0);

// ✅ user input goes in KEYS/ARGV, always
await redis.eval("return redis.call('GET', KEYS[1])", 1, userKey);

// ✅ better still — a registered script
redis.defineCommand('getThing', { numberOfKeys: 1, lua: "return redis.call('GET', KEYS[1])" });
await redis.getThing(userKey);
```

The Lua sandbox blocks `os`, `io`, `require`, and the filesystem — but **script injection still lets an attacker run arbitrary Redis commands as your ACL user**, including `FLUSHALL` if you did not deny it. Defence in depth: never concatenate, and deny dangerous commands at the ACL level.

### Never store secrets in Redis unencrypted

Redis has no encryption at rest. Your data is in RAM in plaintext, in the RDB file in plaintext, and in the AOF in plaintext. Anyone who can read the disk, take a memory dump, or grab a backup from S3 has everything.

- Encrypt sensitive values **before** writing them.
- Treat RDB/AOF backups with the same care as a database dump.
- Enable disk encryption on the volume.
- Set restrictive file permissions:

```bash
chown redis:redis /var/lib/redis
chmod 700 /var/lib/redis
chmod 600 /var/lib/redis/dump.rdb
chmod 600 /etc/redis/redis.conf        # it contains requirepass
```

### Session tokens

```ts
import { randomBytes } from 'node:crypto';

// ❌ predictable / guessable
const sid = `${userId}-${Date.now()}`;

// ✅ 256 bits of CSPRNG entropy
const sid = randomBytes(32).toString('base64url');
await redis.set(`session:${sid}`, JSON.stringify(session), 'EX', 86_400);
```

Also: bound the number of sessions per user, and give every session a TTL so a leaked token expires on its own.

---

## 7. The production hardening checklist

```
   NETWORK
   □ bind to a private interface, never 0.0.0.0
   □ protected-mode yes
   □ firewall / security group restricting 6379 to app servers only
   □ verified unreachable from outside the network
   □ Redis on a private subnet with no public IP

   AUTHENTICATION
   □ ACL users per service, starting from -@all
   □ -@dangerous on every application user
   □ key patterns (~) scoped to each service's namespace
   □ no `nopass` users; the `default` user disabled or locked down
   □ passwords ≥ 32 random characters, from a secrets manager
   □ credentials rotated; never committed to git

   TRANSPORT
   □ TLS if traffic crosses an untrusted network or compliance requires it
   □ tls-auth-clients yes (mTLS) where practical
   □ port 0 to disable plaintext when TLS is on

   COMMANDS
   □ FLUSHALL / FLUSHDB / KEYS / DEBUG / MODULE denied for app users
   □ CONFIG restricted to admins

   PROCESS & FILES
   □ runs as a non-root `redis` user
   □ /var/lib/redis is 700, owned by redis
   □ redis.conf is 600 (it contains secrets)
   □ disk encryption on the data volume

   APPLICATION
   □ user input validated or hashed before entering a key
   □ no PII in key names
   □ Lua parameters only via KEYS/ARGV, never string concatenation
   □ sensitive values encrypted before storage
   □ session IDs from a CSPRNG

   MONITORING
   □ ACL LOG shipped to your SIEM
   □ alerts on auth failures and NOPERM spikes
   □ alerts on unexpected CONFIG SET / MODULE LOAD
   □ backups treated as sensitive data
```

---

## 8. Verifying your own configuration

```bash
# 1. Can you reach it from outside?
nc -zv redis.example.com 6379            # should fail

# 2. Does it demand authentication?
redis-cli -h redis.internal PING
# → (error) NOAUTH Authentication required.   ✅
# → PONG                                       ❌ NO AUTH — fix immediately

# 3. What can the default user do?
redis-cli ACL GETUSER default
# → look for "off" or a heavily restricted rule set

# 4. Are dangerous commands reachable by app users?
redis-cli --user app-api --pass "$PASS" FLUSHALL
# → (error) NOPERM …has no permissions to run the 'flushall' command   ✅

# 5. Is it running as root?
ps -o user= -p $(pgrep -f redis-server)
# → redis   ✅     root  ❌

# 6. Any recent permission failures?
redis-cli ACL LOG

# 7. What is it actually bound to?
redis-cli CONFIG GET bind
redis-cli CONFIG GET protected-mode
```

Run these against every environment, including the staging instance somebody spun up eighteen months ago on a public IP and forgot about. That one is the one that gets you.

---

## Rapid-fire recall

1. Describe the `CONFIG SET dir` attack chain. What is the actual root cause?
2. What does `protected-mode` do, and when does it apply?
3. Why is a short `requirepass` effectively no password at all?
4. Write an ACL for a worker that may only touch `queue:*` with list commands.
5. Why start from `-@all` rather than `+@all -@dangerous`?
6. What does TLS protect against, what does it not, and what does it cost?
7. Why are ACLs better than `rename-command`?
8. Name three places a key name containing PII will show up.
9. What can a Lua injection do, given the sandbox blocks `os` and `io`?
10. Does Redis encrypt data at rest?

<details>
<summary>Answers</summary>

1. Connect without auth → `CONFIG SET dir /root/.ssh` → `CONFIG SET dbfilename authorized_keys` → `SET` a payload containing an SSH public key → `SAVE`. The root cause is a network/authentication misconfiguration, not a Redis vulnerability.
2. When there is no `bind` directive and no password, Redis accepts only loopback connections and returns an explanatory error to everyone else. It is a safety net for the accidental-exposure case.
3. Redis processes hundreds of thousands of `AUTH` attempts per second with no rate limiting, lockout, or delay. Anything short or dictionary-based falls almost immediately.
4. `ACL SETUSER worker on '>...' ~queue:* +lpush +rpush +blmove +lmove +lrem +llen` — starting from nothing and adding only what is needed.
5. A deny-list is always incomplete: the next Redis version adds a command you did not think to deny, and it is allowed by default. An allow-list fails closed.
6. It protects confidentiality in transit, authenticates the server, and (with `tls-auth-clients`) authenticates clients by certificate. It does not protect against a compromised client, a leaked password, or a bad ACL, and it is not a substitute for network isolation. It costs ~10–30% throughput, on the same single thread that runs your commands.
7. ACLs are per-user and changeable at runtime; `rename-command` is global, blunt, requires a restart, breaks tooling, and is deprecated. With ACLs the app cannot run `FLUSHALL` while an operator can.
8. `MONITOR` output, the `SLOWLOG`, `ACL LOG`, `CLIENT LIST`, and the RDB/AOF files (and therefore your backups).
9. Run arbitrary **Redis** commands as your ACL user — including `FLUSHALL`, reading any key the user can read, or writing anywhere in its key space. The sandbox limits OS access, not Redis access.
10. No. Data is plaintext in RAM, in the RDB, and in the AOF. Encrypt sensitive values yourself and encrypt the underlying volume and backups.

</details>

---

**Next:** [Observability & Operations](./24-observability-and-ops.md) — what to graph, what to alert on, and the runbooks.
