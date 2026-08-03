const path = require('node:path')

const DEFAULT_RELEASE_IGNORE_RULES = [
  '.DS_Store',
  'Thumbs.db',
  '.git/',
  '.svn/',
  'node_modules/',
  '*.log'
]

function normalizeRuleLines(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/\r?\n/)
  return values
    .map((item) => String(item || '').trim())
    .filter((item) => item && !item.startsWith('#'))
    .slice(0, 100)
    .map((item) => item.slice(0, 256))
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegExp(rule) {
  let pattern = String(rule || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
  const directoryOnly = pattern.endsWith('/')
  pattern = pattern.replace(/^\/+|\/+$/g, '')
  const anchored = pattern.startsWith('/')
  pattern = pattern.replace(/^\/+/, '')

  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 1
        if (pattern[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += escapeRegex(char)
    }
  }

  const prefix = anchored || pattern.includes('/') ? '^' : '(^|.*/)'
  const suffix = directoryOnly ? '(?:/.*)?$' : '$'
  return new RegExp(`${prefix}${source}${suffix}`)
}

function createReleaseIgnoreMatcher(rules = DEFAULT_RELEASE_IGNORE_RULES) {
  const normalizedRules = normalizeRuleLines(rules)
  const compiled = normalizedRules.map((raw) => {
    const negated = raw.startsWith('!')
    const value = negated ? raw.slice(1) : raw
    return { negated, regex: globToRegExp(value) }
  })

  return (relativePath, isDirectory = false) => {
    const normalizedPath = String(relativePath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
    if (!normalizedPath) return false

    const candidate = isDirectory ? `${normalizedPath}/` : normalizedPath
    let ignored = false
    for (const item of compiled) {
      if (item.regex.test(candidate) || item.regex.test(normalizedPath)) {
        ignored = !item.negated
      }
    }
    return ignored
  }
}

function scanLocalEntries(entries, rules = DEFAULT_RELEASE_IGNORE_RULES) {
  const matcher = createReleaseIgnoreMatcher(rules)
  const summary = { files: 0, directories: 0, bytes: 0, ignored: 0 }

  function visit(localPath, relativePath) {
    const stat = require('node:fs').statSync(localPath)
    const isDirectory = stat.isDirectory()
    if (matcher(relativePath, isDirectory)) {
      summary.ignored += 1
      return
    }
    if (isDirectory) {
      summary.directories += 1
      for (const child of require('node:fs').readdirSync(localPath, { withFileTypes: true })) {
        visit(path.join(localPath, child.name), path.posix.join(relativePath, child.name))
      }
    } else if (stat.isFile()) {
      summary.files += 1
      summary.bytes += stat.size
    }
  }

  for (const entry of entries)
    visit(entry.localPath, entry.archivePath || path.basename(entry.localPath))
  return summary
}

module.exports = {
  DEFAULT_RELEASE_IGNORE_RULES,
  normalizeRuleLines,
  createReleaseIgnoreMatcher,
  scanLocalEntries
}
