# Boolean tag search: OR-groups + negation

Date: 2026-06-26
Status: Approved (design)

## Problem

Tag (`#`) search is **AND-only**. The matcher in
[`taxonomySearch.js`](../../../popup/js/search/taxonomySearch.js) requires every
term to be present:

```js
searchTerms.every((term) => searchString.includes(taxonomyMarker + term))
```

Users want to:

1. **OR** tags — `#dev OR #tech` ("has either tag").
2. Mix **required** and **non-required** tags in one query —
   e.g. the logic of `#dev AND (#tec OR #webdev)`.
3. **Exclude** tags — "does not contain tag X" (no negation exists anywhere in
   search today).

## Decisions

| Question | Decision |
|---|---|
| Syntax | **Comma OR-groups, no keywords.** Space = AND, comma = OR. No `AND`/`OR` words, no parentheses. |
| Scope | **Tags (`#`) only.** Folders (`~`) and groups (`@`) keep AND-only behavior. |
| Negation | **Yes.** `-#tag` = "must NOT contain", applied as an AND-constraint. |
| Matching | **Substring**, unchanged — preserves behavior after the exact-match revert (commit e7c3aae). |
| Grouping depth | **Flat (CNF).** No nested parentheses. |

### Why no keywords / parentheses

- The query is **lowercased** before it reaches search
  ([`common.js` `normalizeSearchTerm`](../../../popup/js/search/common.js)), so
  literal `AND`/`OR` keywords don't survive as distinguishable operators.
- Tags are **`#`-delimited and may contain spaces** (`#machine learning` is a
  valid single tag), so word-operators collide with tags that contain "and"/"or".
- Comma + `-#` are unambiguous symbols that avoid both problems and require no
  grammar/parser stack.

## Grammar & semantics (CNF — "AND of OR-groups")

A tag query is a list of **AND-terms** separated by spaces. Each AND-term is one of:

| Term | Meaning |
|---|---|
| `#a` | must contain tag `a` |
| `#a,#b,#c` | OR-group: must contain **at least one** of a/b/c |
| `-#a` | must **not** contain tag `a` |

A bookmark matches iff **every** AND-term matches. Within a comma OR-group,
members are OR'd. This is conjunctive normal form, which expresses every target
case without parentheses:

```
#dev                        → has dev
#dev #tec,#webdev           → has dev AND (tec OR webdev)
#dev -#archived             → has dev AND NOT archived
#dev #tec,#webdev -#legacy  → has dev AND (tec OR webdev) AND NOT legacy
```

A negated member may also appear inside an OR-group (`#a,-#b` → "contains a OR
lacks b"). The evaluation rule is uniform, so this falls out for free rather than
being a special case:

```js
groups.every((group) =>
  group.some((atom) =>
    atom.negated ? !contains(atom.tag) : contains(atom.tag)
  )
)
```

where `contains(tag)` is the existing `searchString.includes('#' + tag)`.

## Operator reservation

- `,` is the OR operator → a literal comma can no longer be part of a *searched*
  tag name (rare; documented).
- `-` immediately before a `#` is the negation operator. A `-` *inside* a name
  (`#sci-fi`) is untouched.
- `#` and `,` are the only delimiters; tag names may still contain spaces.

## Routing note

`resolveSearchMode` ([`queryParser.js`](../../../popup/js/search/queryParser.js))
enters tag mode only when the query **starts with `#`**, and strips that first
`#`. Consequences:

- The string reaching `searchTaxonomy` for input `#dev #tec,#webdev` is
  `dev #tec,#webdev` — the first tag arrives **without** a leading `#`. The
  parser normalizes by re-prepending `#` so all atoms are uniform.
- A bare `-#archived` does **not** enter tag mode. Negation/OR therefore always
  ride along after a leading positive `#tag` in normal use, which keeps result
  sets bounded.

## Where the code changes

### `popup/js/search/taxonomySearch.js`

- Branch on `taxonomyType === 'tags'`:
  - Tags → new CNF path.
  - Folders/groups → existing `.every(includes)` path, **untouched** (zero risk).
- Add exported `parseTagQuery(query)` → `Array<Array<{tag, negated}>>` (array of
  OR-groups). Exported for unit testing.
  - Normalize: re-prepend `#`, then tokenize anchored on `#`, capturing each
    atom's preceding connector (`,` → OR-with-previous-group; `-` → negated;
    space/none → new AND-group).
  - Drop empty atoms (trailing comma `#dev,`, stray `#`).
- Evaluate with the uniform rule above.

### `popup/js/search/common.js` (`highlightResults`)

- For tag mode, split highlight terms on commas as well as spaces, and drop `-#`
  atoms, so `#tec,#webdev` highlights both badges and excluded tags are not
  highlighted.

### Untouched

- The `  ` (double-space) content-query split — parsing happens *after* it, on
  the taxonomy portion only.
- Caching, scoring, sorting, result-limiting (tags already show all matches).

## Edge cases

- Empty atoms ignored.
- No atoms → empty results (unchanged).
- Bookmarks with no tags trivially satisfy negations; pure-negation queries are
  reachable only via a leading bare `#`, so normal use always has a bounding
  positive term.
- OR-member separator is comma optionally followed by a **single** space
  (`#a, #b`). A comma followed by a **double** space would trip the content-query
  split — documented.

## Backward compatibility

Existing queries parse identically: `#work #todo`, `#react #node`,
`#machine learning`. The only newly-meaningful characters are `,` (was an
inert part of a tag name) and `-#` (previously produced a non-matching term).

## Testing

New `popup/js/search/__tests__/taxonomySearch.test.js`:

- `parseTagQuery` units: single, AND, OR-group, negation, combined, multi-word
  tags, negated-in-OR, trailing/stray commas and `#`, leading-`#`-stripped input.
- `searchTaxonomy` end-to-end (tags): AND regression, OR-group, negation,
  combined, content-query interaction, degenerate inputs.
- Confirm folders/groups behavior is unchanged.

## Docs

- `Tips.md` — "Advanced Searching": document comma-OR and `-#` exclude alongside
  the existing AND-filtering bullet.
- `README.md` / `OPTIONS.md` — extend tag-search references.
