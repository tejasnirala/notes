---
title: Full-Text Search & Pattern Matching
---

# Full-Text Search & Pattern Matching

> **What you will be able to do after this page**
>
> - Explain `tsvector`, `tsquery`, lexemes and stemming, and trace a document through the pipeline.
> - Build a production full-text search with ranking, highlighting and a maintained index.
> - Use `pg_trgm` to make `LIKE '%foo%'` and fuzzy matching indexed.
> - Say honestly when Postgres FTS is enough and when you need Elasticsearch.

---

## 1. The four ways to match text — pick deliberately

| Approach | Good for | Indexable |
| :--- | :--- | :--- |
| `LIKE 'foo%'` | Prefix match | ✅ B-tree (with `text_pattern_ops` for non-C locales) |
| `LIKE '%foo%'` / `ILIKE` | Substring anywhere | ✅ only with `pg_trgm` GIN |
| `~` regex | Complex patterns | ✅ partially, with `pg_trgm` |
| **Full-text search** | Natural language, stemming, ranking | ✅ GIN on `tsvector` |
| `pg_trgm` similarity | Typos, fuzzy names | ✅ GIN/GiST |

Full-text search answers "documents *about* running" (matching `run`, `ran`, `running`). `LIKE '%run%'` answers "the literal substring appears" (also matching `brunch`). They are different questions.

---

## 2. `tsvector` and `tsquery` — the pipeline traced

```sql
SELECT to_tsvector('english', 'The quick brown foxes were jumping over the lazy dogs');
```

```text
INPUT
  "The quick brown foxes were jumping over the lazy dogs"
      │
      ▼  PARSER — split into tokens, classify each (word, number, url, email, host…)
  [The][quick][brown][foxes][were][jumping][over][the][lazy][dogs]
      │
      ▼  DICTIONARY — drop stop words, lowercase, then STEM
  The     → stop word, dropped
  quick   → 'quick'
  brown   → 'brown'
  foxes   → 'fox'      ← stemmed
  were    → stop word, dropped
  jumping → 'jump'     ← stemmed
  over    → stop word, dropped
  the     → stop word, dropped
  lazy    → 'lazi'     ← the Snowball stemmer is not a dictionary; 'lazi' is fine, it's
                          only ever compared against other stemmed output
  dogs    → 'dog'      ← stemmed
      │
      ▼  POSITIONS recorded (used for phrase search and ranking)
OUTPUT tsvector (sorted, deduplicated, with positions):
  'brown':3 'dog':10 'fox':4 'jump':6 'lazi':9 'quick':2
```

A `tsvector` is a **sorted set of lexemes with positions**. A `tsquery` is a boolean expression over lexemes.

```sql
SELECT to_tsquery('english', 'fox & jumping');       -- 'fox' & 'jump'
SELECT plainto_tsquery('english', 'jumping foxes');  -- 'jump' & 'fox'   (all terms ANDed)
SELECT phraseto_tsquery('english', 'quick brown');   -- 'quick' <-> 'brown'  (adjacent)
SELECT websearch_to_tsquery('english', '"quick brown" -lazy fox');
--     'quick' <-> 'brown' & !'lazi' & 'fox'         ← Google-like syntax, PG 11+
```

| Function | Input | Use for |
| :--- | :--- | :--- |
| `to_tsquery` | Operator syntax, **errors on bad input** | Internal, controlled queries |
| `plainto_tsquery` | Plain text, ANDs everything | Simple search boxes |
| `phraseto_tsquery` | Plain text, requires adjacency | Exact phrase search |
| `websearch_to_tsquery` | `"quotes"`, `-negation`, `or` | **User-facing search boxes — use this** |

:::danger[Never pass raw user input to `to_tsquery`]
```sql
SELECT to_tsquery('english', 'foo &');   -- ERROR: syntax error in tsquery
```
A user typing `C++ &` crashes the query. `websearch_to_tsquery` and `plainto_tsquery` sanitise their input and never error. This is a real production bug, not a theoretical one.
:::

### The match operator

```sql
SELECT to_tsvector('english', 'The quick brown foxes')
       @@ websearch_to_tsquery('english', 'fox');       -- true — 'foxes' stems to 'fox'
SELECT to_tsvector('english', 'The quick brown foxes')
       @@ websearch_to_tsquery('english', 'brunch');    -- false
```

### `tsquery` operators

| Operator | Meaning |
| :--- | :--- |
| `&` | AND |
| `\|` | OR |
| `!` | NOT |
| `<->` | followed by (phrase, adjacent) |
| `<N>` | exactly N positions apart |
| `:*` | prefix match — `'post':*` matches `postgres`, `posting` |

```sql
SELECT to_tsvector('english','postgresql tutorial') @@ to_tsquery('english','postgres:*');
```

---

## 3. Production full-text search

Don't call `to_tsvector` in the `WHERE` clause of every query — store it.

### Option A: generated column (PG 12+, the modern default)

```sql
ALTER TABLE articles
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')),    'A') ||
      setweight(to_tsvector('english', coalesce(subtitle, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(body, '')),     'C')
  ) STORED;

CREATE INDEX idx_articles_search ON articles USING GIN (search_vector);
```

`setweight` assigns each lexeme a weight class **A** (highest) through **D**, which `ts_rank` uses. Titles should outrank body text.

:::warning[The generated column must be IMMUTABLE]
`to_tsvector(body)` — the **one-argument** form — is only STABLE, because it depends on the `default_text_search_config` GUC. It's rejected in a generated column. Always pass the config explicitly: `to_tsvector('english', body)`. Same reason you must wrap nullable columns in `coalesce`: `NULL || anything` is NULL, which would wipe the whole vector.
:::

### Option B: expression index (no column, no storage)

```sql
CREATE INDEX idx_articles_search
  ON articles USING GIN (to_tsvector('english', title || ' ' || body));

SELECT * FROM articles
WHERE to_tsvector('english', title || ' ' || body) @@ websearch_to_tsquery('english', 'postgres');
```

Simpler, but the query must repeat the expression **exactly** or the index isn't used. The generated column is more robust.

### Option C: trigger (pre-PG 12, or when the source spans tables)

```sql
CREATE FUNCTION articles_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('english', coalesce(NEW.title,'')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW.body,'')),  'C');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_articles_search
  BEFORE INSERT OR UPDATE OF title, body ON articles
  FOR EACH ROW EXECUTE FUNCTION articles_search_update();
```

### The search query

```sql
SELECT id, title,
       ts_rank_cd(search_vector, q)                          AS rank,
       ts_headline('english', body, q,
                   'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15')
                                                             AS snippet
FROM   articles, websearch_to_tsquery('english', $1) AS q
WHERE  search_vector @@ q
ORDER  BY rank DESC, published_at DESC
LIMIT  20;
```

| Piece | What it does |
| :--- | :--- |
| `ts_rank` | Ranks by term frequency and weights |
| `ts_rank_cd` | Cover-density ranking — also rewards terms appearing **close together**. Usually better |
| `ts_headline` | Generates the highlighted snippet. **Expensive — it reads the original text**, so apply it after `LIMIT` if possible |
| `FROM ..., websearch_to_tsquery(...) AS q` | Computes the query once instead of per row |

:::warning[Ranking is not indexable]
`@@` uses the GIN index to find matches, but `ts_rank` must be computed for **every** matching row before sorting. A query matching 500,000 documents ranks all 500,000. Narrow the candidate set first — add a date filter or a partial index — and consider a two-stage query: cheap filter with `LIMIT 1000`, then rank those.

Also, `ts_headline` is genuinely expensive. Run it only on the final page of results:
```sql
WITH hits AS (
  SELECT id, title, body, ts_rank_cd(search_vector, q) AS rank
  FROM articles, websearch_to_tsquery('english', $1) q
  WHERE search_vector @@ q
  ORDER BY rank DESC LIMIT 20
)
SELECT id, title, ts_headline('english', body, websearch_to_tsquery('english',$1)) FROM hits;
```
:::

### GIN or GiST for `tsvector`?

| | GIN | GiST |
| :--- | :--- | :--- |
| Search speed | **~3× faster** | Slower (lossy — needs a recheck against the heap) |
| Build/update speed | Slower | Faster |
| Size | Larger | Smaller |
| Verdict | **Default choice for FTS** | Only for very write-heavy, small-document cases |

GIN has a `fastupdate` pending list that batches inserts; it's flushed by autovacuum or when it exceeds `gin_pending_list_limit`. That's why a GIN-indexed table needs healthy autovacuum, and why the *first* query after a bulk load can be unexpectedly slow.

---

## 4. `pg_trgm` — fuzzy matching and indexed `LIKE '%x%'`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

SELECT show_trgm('postgres');
-- {"  p"," po",gre,ost,pos,res,"res ",stg,tgr}
```

A trigram is every 3-character substring (padded at the edges). Two strings are similar if they share many trigrams.

```sql
SELECT similarity('postgres', 'postgrez');       -- 0.6
SELECT 'postgres' % 'postgrez';                  -- true if similarity > pg_trgm.similarity_threshold (0.3)
SELECT word_similarity('gres', 'postgres');      -- matches a word within a longer string
```

### The two things this unlocks

```sql
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
```

**1. Indexed substring search:**

```sql
SELECT * FROM products WHERE name ILIKE '%adapt%';   -- ✅ USES THE TRIGRAM INDEX
```

```text
Without pg_trgm:  Seq Scan on products, 2,000,000 rows, 1400 ms
With pg_trgm GIN: Bitmap Index Scan → Bitmap Heap Scan, 312 rows, 4 ms
```

This is impossible in MySQL — `LIKE '%x%'` is always a full scan there.

**2. Typo-tolerant search:**

```sql
SELECT name, similarity(name, 'postgress') AS sim
FROM products
WHERE name % 'postgress'
ORDER BY sim DESC
LIMIT 10;
```

`GiST` supports the `<->` distance operator for **k-nearest-neighbour ordering**, which GIN does not:

```sql
CREATE INDEX ON products USING GIST (name gist_trgm_ops);
SELECT name FROM products ORDER BY name <-> 'postgress' LIMIT 10;   -- index-ordered KNN
```

| | `gin_trgm_ops` | `gist_trgm_ops` |
| :--- | :--- | :--- |
| `LIKE '%x%'`, `ILIKE`, `~` | ✅ faster | ✅ |
| `%` similarity | ✅ | ✅ |
| `ORDER BY col <-> 'x'` (KNN) | ❌ | ✅ |
| Size / build | Larger, slower to build | Smaller, faster |

Related: `levenshtein()`, `soundex()`, `metaphone()` and `difference()` from the **`fuzzystrmatch`** extension, and `unaccent` for stripping diacritics (chain it into your text search config so "Zurich" matches "Zürich").

---

## 5. `LIKE`, `ILIKE` and regex — the index rules

```sql
-- Prefix match: uses a plain B-tree ONLY in the C locale.
-- In any other locale you need an explicit opclass:
CREATE INDEX ON products (name text_pattern_ops);
SELECT * FROM products WHERE name LIKE 'Post%';        -- ✅ uses it

-- Case-insensitive prefix: index the expression
CREATE INDEX ON products (lower(name) text_pattern_ops);
SELECT * FROM products WHERE lower(name) LIKE lower('post') || '%';

-- Suffix match: index the reversed string
CREATE INDEX ON files ((reverse(filename)) text_pattern_ops);
SELECT * FROM files WHERE reverse(filename) LIKE reverse('.pdf') || '%';

-- Anything containing: pg_trgm
```

:::info[PostgreSQL vs MySQL — pattern matching]
| | PostgreSQL | MySQL |
| :--- | :--- | :--- |
| Case sensitivity of `LIKE` | **Case-sensitive** by default | **Case-insensitive** by default (`utf8mb4_0900_ai_ci`) |
| Case-insensitive form | `ILIKE`, or `lower()` + expression index, or `citext` | Just `LIKE` |
| Case-*sensitive* form | Just `LIKE` | `LIKE BINARY` or a `_bin`/`_cs` collation |
| Prefix index | B-tree, needs `text_pattern_ops` outside the C locale | B-tree works directly |
| `LIKE '%x%'` indexed | ✅ **`pg_trgm` GIN** | ❌ never |
| Fuzzy / similarity | `pg_trgm`, `fuzzystrmatch`, KNN with GiST | `SOUNDEX()` only |
| Regex | `~` `~*` `!~` `!~*`, `regexp_replace`, `regexp_matches`, `regexp_split_to_table` | `REGEXP`, `REGEXP_REPLACE` (8.0+) |

The `text_pattern_ops` requirement catches Postgres users out: in a non-C locale, a normal index sorts by collation rules that don't match `LIKE`'s left-to-right byte comparison, so the planner won't use it for a prefix pattern.
:::

---

## 6. Full-text search: Postgres vs MySQL vs Elasticsearch

:::info[PostgreSQL vs MySQL — full-text search]
| | PostgreSQL | MySQL (InnoDB FULLTEXT) |
| :--- | :--- | :--- |
| Availability | Core, all versions | InnoDB since 5.6, MyISAM before that |
| Index | GIN/GiST on `tsvector` | `FULLTEXT` index |
| Query | `@@` with `tsquery` | `MATCH(col) AGAINST(...)` in NATURAL LANGUAGE / BOOLEAN mode |
| Stemming | ✅ Snowball, many languages, configurable | ❌ **No stemming** — "run" won't match "running" |
| Stop words | Configurable dictionaries | Configurable list |
| Weighted fields | ✅ `setweight` A/B/C/D | ❌ |
| Ranking | `ts_rank`, `ts_rank_cd` | Built-in relevance score, not tunable |
| Highlighting | ✅ `ts_headline` | ❌ do it in the app |
| Phrase search | ✅ `<->` and `<N>` | ✅ in boolean mode |
| Synonyms / thesaurus | ✅ dictionary configs | ❌ |
| CJK / n-gram | Via `pg_bigm`/extensions | ✅ built-in ngram and MeCab parsers |
| Custom dictionaries | ✅ (ispell, synonym, unaccent) | Limited |

Postgres FTS is substantially more capable — stemming and weighted ranking alone decide most comparisons. MySQL's built-in n-gram parser for CJK is one genuine point in its favour.
:::

**And the honest comparison with a dedicated engine:**

| Postgres FTS is enough | You want Elasticsearch / OpenSearch |
| :--- | :--- |
| Up to a few million documents | Tens of millions, or heavy search traffic |
| Search is one feature, not the product | Search *is* the product |
| You want one system, one backup, transactional consistency | You can operate a second stateful system |
| Filters combine with relational predicates and joins | You need faceting, aggregations, per-field analyzers, "did you mean", learning-to-rank |
| Freshness must be immediate | Near-real-time is acceptable |

**The single biggest operational advantage of Postgres FTS is transactional consistency** — the search index is updated in the same transaction as the row, so there's no sync pipeline, no lag, no reindexing job, and no split-brain between the database and the search cluster. That is worth a lot, and it's the answer to "why not just use Elasticsearch."

---

## 7. Rapid-fire recall

<details>
<summary>**Explain `tsvector` and `tsquery`.**</summary>

`to_tsvector` runs text through a parser that splits it into tokens, then dictionaries that drop stop words, lowercase, and stem each token to a lexeme, producing a sorted set of lexemes with their positions. `tsquery` is a boolean expression over lexemes, built with `&`, `|`, `!` and the phrase operator `<->`. The `@@` operator tests whether a vector satisfies a query. Because both sides are stemmed, searching for "running" matches a document containing "ran" — which is exactly the difference between full-text search and `LIKE`.
</details>

<details>
<summary>**How do you build a production search on Postgres?**</summary>

Store a `tsvector` as a `STORED` generated column combining the searchable fields with `setweight` so titles outrank body text, and put a GIN index on it. Query with `websearch_to_tsquery` — never `to_tsquery`, which throws a syntax error on user input like a stray ampersand. Rank with `ts_rank_cd`, and generate snippets with `ts_headline` only after the `LIMIT`, because it re-reads the original text and is expensive. Remember to pass the language config explicitly to `to_tsvector` inside a generated column, since the one-argument form isn't immutable.
</details>

<details>
<summary>**Why is ranking slow even with a GIN index?**</summary>

Because the index only accelerates matching. Once `@@` produces the candidate set, `ts_rank` has to be evaluated for every matching row before the sort can happen — there's no index on relevance. So a query matching half a million documents ranks half a million documents regardless of the `LIMIT`. The fixes are narrowing the candidate set with additional predicates or a partial index, and a two-stage query that takes a cheap top-N first and does expensive work only on those.
</details>

<details>
<summary>**How do you make `LIKE '%foo%'` fast?**</summary>

The `pg_trgm` extension with a GIN index using `gin_trgm_ops`. It indexes every three-character substring, so a `%foo%` pattern becomes a lookup of the trigrams in `foo` and an intersection of their posting lists. It also powers similarity search with the `%` operator for typo tolerance, and with a GiST index you additionally get `ORDER BY col <-> 'query'` k-nearest-neighbour ranking. MySQL has no equivalent at all — `LIKE '%x%'` is always a full table scan there.
</details>

<details>
<summary>**GIN or GiST?**</summary>

GIN for reads, GiST for writes. GIN is roughly three times faster to search and is the default choice for full-text search, but it's larger and slower to build and update — though its `fastupdate` pending list mitigates insert cost at the price of needing healthy autovacuum. GiST is lossy, so it rechecks candidates against the heap, making searches slower, but it's smaller and cheaper to maintain. The one thing only GiST does is distance-ordered nearest-neighbour queries with the `<->` operator.
</details>

<details>
<summary>**When would you move off Postgres FTS to Elasticsearch?**</summary>

When search stops being a feature and becomes the product: tens of millions of documents, heavy query volume, or requirements like faceting, per-field analyzers, did-you-mean, and learning-to-rank that Postgres doesn't do. Below that, Postgres FTS wins on operational simplicity, and the big advantage is transactional consistency — the search index updates in the same transaction as the row, so there's no sync pipeline, no lag, and nothing to reindex after a failure. I'd only take on a second stateful system when the search requirements genuinely demand it.
</details>

<details>
<summary>**What's the difference between Postgres and MySQL full-text search?**</summary>

The big one is stemming: Postgres runs Snowball stemmers so "running" matches "ran," and MySQL's FULLTEXT does no stemming at all. Postgres also supports weighted fields with `setweight`, tunable ranking with `ts_rank_cd`, snippet generation with `ts_headline`, and configurable dictionaries including synonyms and unaccent — none of which MySQL has. MySQL's genuine advantage is a built-in n-gram parser for CJK languages, where Postgres needs an extension.
</details>

---

**Next:** [Indexes →](./13-indexes.md) — every index type, and when each one wins.
