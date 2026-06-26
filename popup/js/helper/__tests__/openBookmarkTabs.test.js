import { describe, expect, jest, test } from '@jest/globals'
import {
  collectOpenableBookmarkUrls,
  createOpenTabsWarning,
  getOpenTabsWarningThreshold,
  OPEN_TABS_WARNING_THRESHOLD_DEFAULT,
  openUrlsInTabs,
} from '../openBookmarkTabs.js'

describe('getOpenTabsWarningThreshold', () => {
  test('returns the configured integer when valid', () => {
    expect(getOpenTabsWarningThreshold({ openTabsWarningThreshold: 5 })).toBe(5)
  })

  test('falls back to the default for missing, zero, negative or non-integer values', () => {
    expect(getOpenTabsWarningThreshold({})).toBe(OPEN_TABS_WARNING_THRESHOLD_DEFAULT)
    expect(getOpenTabsWarningThreshold({ openTabsWarningThreshold: 0 })).toBe(OPEN_TABS_WARNING_THRESHOLD_DEFAULT)
    expect(getOpenTabsWarningThreshold({ openTabsWarningThreshold: -3 })).toBe(OPEN_TABS_WARNING_THRESHOLD_DEFAULT)
    expect(getOpenTabsWarningThreshold({ openTabsWarningThreshold: 2.5 })).toBe(OPEN_TABS_WARNING_THRESHOLD_DEFAULT)
  })
})

describe('createOpenTabsWarning', () => {
  test('includes the count and the threshold', () => {
    const text = createOpenTabsWarning(42, 30)
    expect(text).toContain('Open 42 bookmarks')
    expect(text).toContain('30')
  })
})

describe('collectOpenableBookmarkUrls', () => {
  test('maps originalUrl, drops blanks, and preserves order', () => {
    const urls = collectOpenableBookmarkUrls([
      { originalUrl: 'https://a.test' },
      { originalUrl: '' },
      { url: 'https://b.test' },
      {},
    ])
    expect(urls).toEqual(['https://a.test', 'https://b.test'])
  })
})

describe('openUrlsInTabs', () => {
  test('opens background tabs via the tabs API when available', () => {
    const create = jest.fn()
    const opened = openUrlsInTabs(['https://a.test', 'https://b.test'], { tabs: { create } })
    expect(opened).toBe(2)
    expect(create).toHaveBeenNthCalledWith(1, { active: false, url: 'https://a.test' })
    expect(create).toHaveBeenNthCalledWith(2, { active: false, url: 'https://b.test' })
  })

  test('falls back to window.open when the tabs API is unavailable', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null)
    const opened = openUrlsInTabs(['https://a.test'], {})
    expect(opened).toBe(1)
    expect(openSpy).toHaveBeenCalledWith('https://a.test', '_newtab')
    openSpy.mockRestore()
  })
})
