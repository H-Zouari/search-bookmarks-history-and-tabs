/**
 * @file Helpers for opening selected bookmarks in new browser tabs.
 *
 * Responsibilities:
 * - Resolve the configurable warning threshold from user options.
 * - Build the over-threshold confirmation message.
 * - Collect openable URLs from bookmark objects.
 * - Open URLs in background tabs, falling back to window.open when the tabs API is unavailable.
 */

/** Default number of tabs above which opening prompts for confirmation. */
export const OPEN_TABS_WARNING_THRESHOLD_DEFAULT = 30

/**
 * Resolve the configured warning threshold, falling back to the default.
 *
 * @param {Object} [opts={}] Effective options.
 * @returns {number} Threshold (integer >= 1).
 */
export function getOpenTabsWarningThreshold(opts = {}) {
  const value = opts.openTabsWarningThreshold
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value
  }
  return OPEN_TABS_WARNING_THRESHOLD_DEFAULT
}

/**
 * Build the confirmation text shown before opening many tabs.
 *
 * @param {number} count Number of tabs that would open.
 * @param {number} threshold Configured warning threshold.
 * @returns {string} Confirmation message.
 */
export function createOpenTabsWarning(count, threshold) {
  return [
    `Open ${count} bookmarks in new tabs?`,
    '',
    `This is more than the ${threshold}-tab warning limit and may slow down your browser.`,
    '',
    'Cancel and narrow the selection if this was not intended.',
  ].join('\n')
}

/**
 * Collect openable URLs from bookmark objects, preserving order.
 *
 * @param {Array<Object>} [bookmarks=[]] Bookmark objects.
 * @returns {Array<string>} Non-empty URLs.
 */
export function collectOpenableBookmarkUrls(bookmarks = []) {
  const urls = []
  for (const bookmark of bookmarks) {
    const url = bookmark?.originalUrl || bookmark?.url || ''
    if (url) {
      urls.push(url)
    }
  }
  return urls
}

/**
 * Open URLs in new background tabs, falling back to window.open.
 *
 * @param {Array<string>} [urls=[]] URLs to open.
 * @param {Object} [browserApi={}] Browser API namespace (chrome/browser).
 * @returns {number} Number of tabs opened.
 */
export function openUrlsInTabs(urls = [], browserApi = {}) {
  let opened = 0
  for (const url of urls) {
    if (typeof browserApi?.tabs?.create === 'function') {
      browserApi.tabs.create({ active: false, url })
    } else {
      window.open(url, '_newtab')
    }
    opened += 1
  }
  return opened
}
