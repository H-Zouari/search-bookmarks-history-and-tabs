/**
 * @file Implements dedicated tag (`#`) and folder (`~`) taxonomy searches.
 *
 * Strategy:
 * - Provide AND-based filtering so queries like `#react #node` or `~Projects ~React` match bookmarks with every term.
 * - Power the tags and folders overview pages with aggregated counts derived from bookmark metadata.
 * - Maintain cached taxonomy indexes for quick lookups when switching between popup navigation modes.
 *
 * Scoring:
 * - Matches always report a `searchScore` of 1 before entering the shared scoring pipeline.
 * - Taxonomy results are marked with `searchApproach: 'taxonomy'` to keep rendering and analytics aware of the source.
 */

/**
 * Parse a `#`-tag query into conjunctive-normal-form OR-groups.
 *
 * Grammar: space-separated AND-terms; `,` joins tags into an OR-group;
 * a `-` immediately before a `#` negates that tag. The caller has already
 * stripped the leading `#`, so we re-prepend it to make every atom uniform.
 *
 * @param {string} query - Tag portion of the search term (leading `#` stripped).
 * @returns {Array<Array<{tag: string, negated: boolean}>>} OR-groups.
 */
export function parseTagQuery(query) {
  const normalized = `#${(query || '').trim()}`
  const parts = normalized.split('#')
  const groups = []

  for (let k = 1; k < parts.length; k++) {
    const prevTrailing = parts[k - 1].match(/[,\s-]*$/)[0]
    const negated = prevTrailing.includes('-')
    const orWithPrevious = prevTrailing.includes(',')
    const tag = parts[k]
      .replace(/[,\s-]*$/, '')
      .trim()
      .toLowerCase()
    if (!tag) continue

    if (orWithPrevious && groups.length) {
      groups[groups.length - 1].push({ tag, negated })
    } else {
      groups.push([{ tag, negated }])
    }
  }

  return groups
}

/**
 * True when ANY OR-group member is satisfied for every group (CNF).
 * A negated atom is satisfied when its tag is absent.
 *
 * @param {Array<Array<{tag: string, negated: boolean}>>} groups
 * @param {string} searchString - Lowercased `#`-joined tag string (`tagsLower`).
 * @returns {boolean}
 */
function matchesTagGroups(groups, searchString) {
  return groups.every((group) =>
    group.some((atom) => {
      const has = searchString.includes(`#${atom.tag}`)
      return atom.negated ? !has : has
    }),
  )
}

/**
 * Shared content-filter used by the `  ` (double-space) hybrid search.
 *
 * @param {Object} entry - Bookmark-derived entry.
 * @param {string} contentQuery - Lowercased content filter.
 * @returns {boolean}
 */
function matchesContentQuery(entry, contentQuery) {
  const title = entry.titleLower || (entry.title || '').toLowerCase()
  const url = entry.url || ''
  return title.includes(contentQuery) || url.includes(contentQuery)
}

/**
 * Build the highlight term string for tag mode: positive tags only,
 * space-separated, so the existing space-splitting highlighter marks each badge.
 *
 * @param {string} query - Tag portion of the search term (leading `#` stripped).
 * @returns {string} e.g. `#dev #tec #webdev`
 */
export function buildTagHighlightTerms(query) {
  return parseTagQuery(query)
    .flat()
    .filter((atom) => !atom.negated)
    .map((atom) => `#${atom.tag}`)
    .join(' ')
}

/**
 * Simple, precise search for bookmark tags and folder names
 * Executes AND search with the terms in searchTerm, separated by spaces
 *
 * @param {string} searchTerm
 * @param {'tags' | 'folder'} taxonomyType
 * @param {Array<Object>} data - Bookmark-derived taxonomy entries.
 * @returns {Array<Object>} Taxonomy results with score metadata.
 */
export function searchTaxonomy(searchTerm, taxonomyType, data) {
  /** Search results */
  const results = []
  /** Marker for taxonomy search mode */
  let taxonomyMarker = '#'
  if (taxonomyType === 'folder') taxonomyMarker = '~'
  if (taxonomyType === 'group') taxonomyMarker = '@'

  // Split by double space to separate taxonomy filter from content search
  let taxonomyQuery = searchTerm
  let contentQuery = ''
  const splitIndex = searchTerm.indexOf('  ')
  if (splitIndex !== -1) {
    taxonomyQuery = searchTerm.substring(0, splitIndex)
    contentQuery = searchTerm
      .substring(splitIndex + 2)
      .trim()
      .toLowerCase()
  }

  if (taxonomyType === 'tags') {
    const groups = parseTagQuery(taxonomyQuery)
    if (!groups.length) return results
    for (const entry of data) {
      if (!entry) continue
      if (contentQuery && !matchesContentQuery(entry, contentQuery)) continue
      const searchString = entry.tagsLower || (entry.tags || '').toLowerCase()
      if (matchesTagGroups(groups, searchString)) {
        results.push({ ...entry, searchApproach: 'taxonomy' })
      }
    }
    return results
  }

  // Folders/groups keep the existing AND-only behavior.
  const searchTerms = taxonomyQuery
    .split(taxonomyMarker)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0)

  if (searchTerms.length) {
    for (const entry of data) {
      if (!entry) continue

      if (contentQuery && !matchesContentQuery(entry, contentQuery)) continue

      let searchString = ''
      if (taxonomyType === 'group') {
        searchString = entry.groupLower ? `@${entry.groupLower}` : entry.group ? `@${entry.group}`.toLowerCase() : ''
      } else {
        searchString = entry[`${taxonomyType}Lower`] || (entry[taxonomyType] || '').toLowerCase()
      }

      if (searchTerms.every((term) => searchString.includes(taxonomyMarker + term))) {
        results.push({
          ...entry,
          searchApproach: 'taxonomy',
        })
      }
    }
  }

  return results
}

/**
 * Build a tag-to-bookmark index from the current bookmark model.
 *
 * @returns {Object<string, Array<string>>} Map of tag name to bookmark ids.
 */
export function getUniqueTags() {
  ext.index.taxonomy.tags = {}
  for (const el of ext.model.bookmarks) {
    if (el.tags) {
      for (let tag of el.tags.split('#')) {
        tag = tag.trim()
        if (tag) {
          if (!ext.index.taxonomy.tags[tag]) {
            ext.index.taxonomy.tags[tag] = [el.originalId]
          } else {
            ext.index.taxonomy.tags[tag].push(el.originalId)
          }
        }
      }
    }
  }
  return ext.index.taxonomy.tags
}

/**
 * Build (or reuse) a memoized folder-to-bookmark index.
 *
 * @returns {Object<string, Array<string>>} Map of folder name to bookmark ids.
 */
export function getUniqueFolders() {
  // This function is memoized, as the folders don't change while the extension is open
  if (!ext?.index.taxonomy.folders) {
    const foldersDictionary = {}
    for (const el of ext.model.bookmarks) {
      if (el.folder) {
        for (let folderName of el.folder.split('~')) {
          folderName = folderName.trim()
          if (folderName) {
            if (!foldersDictionary[folderName]) {
              foldersDictionary[folderName] = [el.originalId]
            } else {
              foldersDictionary[folderName].push(el.originalId)
            }
          }
        }
      }
    }
    ext.index.taxonomy.folders = foldersDictionary
  }
  return ext.index.taxonomy.folders
}

/**
 * Clears the memoized folders dictionary so it can be rebuilt on demand.
 * Call this after mutating ext.model.bookmarks to keep folder views in sync.
 */
export function resetUniqueFoldersCache() {
  if (ext?.index?.taxonomy) {
    ext.index.taxonomy.folders = undefined
  }
}

/**
 * Build a group-to-tab index from the current tab model.
 *
 * @returns {Object<string, Array<number>>} Map of group name to tab ids.
 */
export function getUniqueGroups() {
  const groupsDictionary = {}
  const tabs = ext.model.tabs || []

  for (const el of tabs) {
    if (el.group) {
      const groupName = el.group
      if (!groupsDictionary[groupName]) {
        groupsDictionary[groupName] = [el.originalId]
      } else {
        groupsDictionary[groupName].push(el.originalId)
      }
    }
  }

  return groupsDictionary
}
