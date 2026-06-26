import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { clearTestExt, createTestExt } from '../../__tests__/testUtils.js'
import { buildTagHighlightTerms, searchTaxonomy } from '../taxonomySearch.js'

const bm = (originalId, tagsLower, extra = {}) => ({
  originalId,
  title: originalId,
  url: `https://example.com/${originalId}`,
  tagsLower,
  ...extra,
})

const ids = (results) => results.map((r) => r.originalId).sort()

describe('searchTaxonomy tags: boolean queries', () => {
  const data = [
    bm('a', '#dev #frontend'),
    bm('b', '#dev #backend'),
    bm('c', '#dev #webdev'),
    bm('d', '#ops #backend'),
    bm('e', '#dev #legacy #backend'),
    bm('f', ''),
  ]

  test('AND is unchanged (regression)', () => {
    expect(ids(searchTaxonomy('dev #backend', 'tags', data))).toEqual(['b', 'e'])
  })

  test('OR-group matches any member', () => {
    // dev AND (frontend OR webdev)
    expect(ids(searchTaxonomy('dev #frontend,#webdev', 'tags', data))).toEqual(['a', 'c'])
  })

  test('negation excludes', () => {
    // dev AND NOT backend
    expect(ids(searchTaxonomy('dev -#backend', 'tags', data))).toEqual(['a', 'c'])
  })

  test('combined OR-group + negation', () => {
    // dev AND (frontend OR backend) AND NOT legacy
    expect(ids(searchTaxonomy('dev #frontend,#backend -#legacy', 'tags', data))).toEqual(['a', 'b'])
  })

  test('marks results with taxonomy approach', () => {
    const results = searchTaxonomy('dev #frontend', 'tags', data)
    expect(results[0].searchApproach).toBe('taxonomy')
  })

  test('empty / no-tag query returns no results', () => {
    expect(searchTaxonomy('', 'tags', data)).toEqual([])
  })

  test('content query still narrows by title/url', () => {
    // dev tag, then double-space content filter on url "/c"
    expect(ids(searchTaxonomy('dev  /c', 'tags', data))).toEqual(['c'])
  })
})

describe('taxonomy search', () => {
  let taxonomyModule

  beforeEach(async () => {
    createTestExt({
      model: {
        bookmarks: [],
      },
      index: {
        taxonomy: {},
      },
    })
    taxonomyModule = await import('../taxonomySearch.js')
  })

  afterEach(() => {
    clearTestExt()
  })

  test('searchTaxonomy finds entries containing all tag terms', () => {
    const { searchTaxonomy } = taxonomyModule
    const data = [
      {
        originalId: '1',
        tags: '#foo #bar',
        type: 'bookmark',
      },
      {
        originalId: '2',
        tags: '#foo',
        type: 'bookmark',
      },
    ]

    const result = searchTaxonomy('foo #bar', 'tags', data)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      originalId: '1',
      searchApproach: 'taxonomy',
    })
  })

  test('searchTaxonomy finds entries based on folder names', () => {
    const { searchTaxonomy } = taxonomyModule
    const data = [
      {
        originalId: '3',
        folder: '~Work ~Projects',
      },
      {
        originalId: '4',
        folder: '~Personal',
      },
    ]

    const result = searchTaxonomy('work ~projects', 'folder', data)

    expect(result).toHaveLength(1)
    expect(result[0].originalId).toBe('3')
  })

  test('getUniqueTags aggregates tag usage', () => {
    const { getUniqueTags } = taxonomyModule
    ext.model.bookmarks = [
      { originalId: '1', tags: '#foo #bar' },
      { originalId: '2', tags: '#foo' },
      { originalId: '3', tags: '' },
    ]

    const result = getUniqueTags()

    expect(result.foo).toEqual(['1', '2'])
    expect(result.bar).toEqual(['1'])
  })

  test('getUniqueFolders caches computed folders', () => {
    const { getUniqueFolders } = taxonomyModule
    ext.model.bookmarks = [
      { originalId: '1', folder: '~Parent ~Child' },
      { originalId: '2', folder: '~Parent' },
    ]

    const first = getUniqueFolders()
    expect(first.Parent.sort()).toEqual(['1', '2'])
    expect(first.Child).toEqual(['1'])

    ext.model.bookmarks = []
    const second = getUniqueFolders()
    expect(second).toBe(first)
  })

  test('resetUniqueFoldersCache invalidates cached folder data', () => {
    const { getUniqueFolders, resetUniqueFoldersCache } = taxonomyModule
    ext.model.bookmarks = [
      { originalId: '1', folder: '~Work ~Projects' },
      { originalId: '2', folder: '~Work' },
    ]

    const first = getUniqueFolders()
    expect(first.Work.sort()).toEqual(['1', '2'])

    // Simulate a bookmark removal that affects the folder map
    ext.model.bookmarks = [{ originalId: '2', folder: '~Work' }]
    resetUniqueFoldersCache()

    const second = getUniqueFolders()
    expect(second.Work).toEqual(['2'])
    expect(second).not.toBe(first)
  })

  test('searchTaxonomy handles trailing whitespace in tag terms', () => {
    const { searchTaxonomy } = taxonomyModule
    const data = [
      {
        originalId: '1',
        tags: '#react #node',
        type: 'bookmark',
      },
      {
        originalId: '2',
        tags: '#react',
        type: 'bookmark',
      },
    ]

    // Test with trailing whitespace after tag
    const resultWithTrailingSpace = searchTaxonomy('react ', 'tags', data)
    expect(resultWithTrailingSpace).toHaveLength(2)
    expect(resultWithTrailingSpace[0].originalId).toBe('1')
    expect(resultWithTrailingSpace[1].originalId).toBe('2')

    // Test with multiple tags where last has trailing whitespace
    const resultMultipleTags = searchTaxonomy('react #node ', 'tags', data)
    expect(resultMultipleTags).toHaveLength(1)
    expect(resultMultipleTags[0].originalId).toBe('1')
  })

  test('searchTaxonomy handles trailing whitespace in folder terms', () => {
    const { searchTaxonomy } = taxonomyModule
    const data = [
      {
        originalId: '1',
        folder: '~Work ~Projects',
      },
      {
        originalId: '2',
        folder: '~Work',
      },
    ]

    // Test with trailing whitespace after folder
    const resultWithTrailingSpace = searchTaxonomy('work ', 'folder', data)
    expect(resultWithTrailingSpace).toHaveLength(2)

    // Test with multiple folders where last has trailing whitespace
    const resultMultipleFolders = searchTaxonomy('work ~projects ', 'folder', data)
    expect(resultMultipleFolders).toHaveLength(1)
    expect(resultMultipleFolders[0].originalId).toBe('1')
  })

  test('searchTaxonomy ignores empty terms from excessive whitespace', () => {
    const { searchTaxonomy } = taxonomyModule
    const data = [
      {
        originalId: '1',
        tags: '#test',
        type: 'bookmark',
      },
    ]

    // Test with multiple spaces creating empty terms
    const result = searchTaxonomy('test  ', 'tags', data)
    expect(result).toHaveLength(1)
    expect(result[0].originalId).toBe('1')
  })

  test('searchTaxonomy supports hybrid taxonomy + text search with DOUBLE SPACE separator', () => {
    const { searchTaxonomy } = taxonomyModule
    const data = [
      {
        originalId: '1',
        group: '@KVR',
        title: 'Project Alpha Temp',
        url: 'http://temp.com',
      },
      {
        originalId: '2',
        group: '@KVR',
        title: 'Project Beta',
        url: 'http://beta.com',
      },
      {
        originalId: '3',
        group: '@Other',
        title: 'Temp Project',
        url: 'http://other.com',
      },
    ]

    // 1. Double space separator used: "KVR  temp"
    // Expect: Group matches "KVR" AND (title OR url matches "temp")
    const result = searchTaxonomy('KVR  temp', 'group', data)

    expect(result).toHaveLength(1)
    expect(result[0].originalId).toBe('1')

    // 2. Searching for invalid text match
    const resultNone = searchTaxonomy('KVR  nomatch', 'group', data)
    expect(resultNone).toHaveLength(0)

    // 3. Searching for taxonomy only (no text part) - trailing double space
    // This simulates the user just clicking the badge and getting the trailing space
    const resultOnlyTaxonomy = searchTaxonomy('KVR  ', 'group', data)
    expect(resultOnlyTaxonomy).toHaveLength(2)
  })

  test('searchTaxonomy supports hybrid search with folder type (~Blogs martin example)', () => {
    const { searchTaxonomy } = taxonomyModule
    const data = [
      {
        originalId: '10',
        folder: '~Blogs',
        title: 'Martin Fowler',
        url: 'https://martinfowler.com',
      },
      {
        originalId: '11',
        folder: '~Blogs',
        title: 'Another Blog',
        url: 'https://example.com',
      },
    ]

    // User example: "~Blogs  martin" (Input normalized/stripped by caller)
    const result = searchTaxonomy('Blogs  martin', 'folder', data)

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Martin Fowler')
  })

  test('getUniqueGroups aggregates group usage', () => {
    const { getUniqueGroups } = taxonomyModule
    ext.model.tabs = [
      { originalId: '1', group: 'Work' },
      { originalId: '2', group: 'Work' },
      { originalId: '3', group: 'Personal' },
      { originalId: '4' }, // No group
    ]

    const result = getUniqueGroups()

    expect(result.Work).toEqual(['1', '2'])
    expect(result.Personal).toEqual(['3'])
    expect(Object.keys(result)).not.toContain('undefined')
  })
})

describe('parseTagQuery', () => {
  let parseTagQuery

  beforeEach(async () => {
    const taxonomyModule = await import('../taxonomySearch.js')
    parseTagQuery = taxonomyModule.parseTagQuery
  })

  test('single tag (leading # already stripped by caller)', () => {
    expect(parseTagQuery('dev')).toEqual([[{ tag: 'dev', negated: false }]])
  })

  test('AND of two tags', () => {
    expect(parseTagQuery('dev #todo')).toEqual([[{ tag: 'dev', negated: false }], [{ tag: 'todo', negated: false }]])
  })

  test('OR-group via comma', () => {
    expect(parseTagQuery('dev #tec,#webdev')).toEqual([
      [{ tag: 'dev', negated: false }],
      [
        { tag: 'tec', negated: false },
        { tag: 'webdev', negated: false },
      ],
    ])
  })

  test('negation via -#', () => {
    expect(parseTagQuery('dev -#archived')).toEqual([
      [{ tag: 'dev', negated: false }],
      [{ tag: 'archived', negated: true }],
    ])
  })

  test('combined OR-group + negation', () => {
    expect(parseTagQuery('dev #tec,#webdev -#legacy')).toEqual([
      [{ tag: 'dev', negated: false }],
      [
        { tag: 'tec', negated: false },
        { tag: 'webdev', negated: false },
      ],
      [{ tag: 'legacy', negated: true }],
    ])
  })

  test('negated member inside an OR-group', () => {
    expect(parseTagQuery('a,-#b')).toEqual([
      [
        { tag: 'a', negated: false },
        { tag: 'b', negated: true },
      ],
    ])
  })

  test('multi-word tags survive in an OR-group', () => {
    expect(parseTagQuery('machine learning,#ai')).toEqual([
      [
        { tag: 'machine learning', negated: false },
        { tag: 'ai', negated: false },
      ],
    ])
  })

  test('lowercases tag names', () => {
    expect(parseTagQuery('Dev #TEC,#WebDev')).toEqual([
      [{ tag: 'dev', negated: false }],
      [
        { tag: 'tec', negated: false },
        { tag: 'webdev', negated: false },
      ],
    ])
  })

  test('ignores trailing comma / stray markers / empty query', () => {
    expect(parseTagQuery('dev,')).toEqual([[{ tag: 'dev', negated: false }]])
    expect(parseTagQuery('')).toEqual([])
    expect(parseTagQuery('   ')).toEqual([])
  })
})

describe('buildTagHighlightTerms', () => {
  test('expands OR-groups and drops negated tags', () => {
    expect(buildTagHighlightTerms('dev #tec,#webdev -#legacy')).toBe('#dev #tec #webdev')
  })

  test('empty query yields empty string', () => {
    expect(buildTagHighlightTerms('')).toBe('')
  })
})
