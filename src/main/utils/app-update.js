const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/i
const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32'])
const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64'])

function normalizeVersion(value) {
  if (typeof value !== 'string') throw new Error('版本号必须是字符串')

  let candidate = value.trim()
  if (/^v/i.test(candidate)) candidate = candidate.slice(1).trim()

  const match = candidate.match(SEMVER_PATTERN)
  if (!match) throw new Error(`无效版本号: ${String(value)}`)

  return `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`
}

function parseVersion(value) {
  const normalized = normalizeVersion(value)
  const match = normalized.match(SEMVER_PATTERN)
  return {
    normalized,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function compareNumericStrings(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)

  if (leftNumeric && rightNumeric) return compareNumericStrings(left, right)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareVersions(left, right) {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)

  for (const field of ['major', 'minor', 'patch']) {
    const comparison = compareNumericStrings(leftVersion[field], rightVersion[field])
    if (comparison !== 0) return comparison
  }

  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) return 0
  if (leftVersion.prerelease.length === 0) return 1
  if (rightVersion.prerelease.length === 0) return -1

  const identifierCount = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < identifierCount; index += 1) {
    if (index >= leftVersion.prerelease.length) return -1
    if (index >= rightVersion.prerelease.length) return 1

    const comparison = comparePrereleaseIdentifiers(
      leftVersion.prerelease[index],
      rightVersion.prerelease[index]
    )
    if (comparison !== 0) return comparison
  }

  return 0
}

function isNewerVersion(latest, current) {
  return compareVersions(latest, current) > 0
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    )
  })
}

function sanitizeAssetName(name) {
  if (typeof name !== 'string') throw new Error('资产文件名必须是字符串')

  const sanitized = name.trim()
  if (!sanitized) throw new Error('资产文件名不能为空')
  if (containsControlCharacter(sanitized)) {
    throw new Error('资产文件名不能包含控制字符')
  }
  if (sanitized.includes('/') || sanitized.includes('\\')) {
    throw new Error('资产文件名不能包含路径分隔符')
  }
  if (sanitized === '.' || sanitized === '..') {
    throw new Error('资产文件名不能是路径跳转名称')
  }

  return sanitized
}

function assertPlatformAndArchitecture(options = {}) {
  const { platform, arch } = options || {}
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`不支持的平台: ${String(platform)}，仅支持 darwin 或 win32`)
  }
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`不支持的架构: ${String(arch)}，仅支持 x64 或 arm64`)
  }
  return { platform, arch }
}

function getSafeAssetCandidate(asset) {
  if (!asset || typeof asset.name !== 'string') return null
  try {
    return { asset, name: sanitizeAssetName(asset.name) }
  } catch {
    return null
  }
}

function selectReleaseAsset(release, options = {}) {
  const { platform, arch } = assertPlatformAndArchitecture(options)
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const candidates = assets.map(getSafeAssetCandidate).filter(Boolean)

  const expectedVersion = options.version ? normalizeVersion(options.version) : null
  const expectedName = expectedVersion
    ? platform === 'darwin'
      ? `Ops Desktop-${expectedVersion}-${arch}.dmg`
      : `Ops Desktop-${expectedVersion}-windows-${arch}.exe`
    : null
  const exactPattern =
    platform === 'darwin'
      ? new RegExp(`^Ops Desktop(?:-.+)?-${arch}\\.dmg$`, 'i')
      : new RegExp(`^Ops Desktop(?:-.+)?-windows-${arch}\\.exe$`, 'i')

  const exactMatch = expectedName
    ? candidates.find((candidate) => candidate.name.toLowerCase() === expectedName.toLowerCase())
    : candidates.find((candidate) => exactPattern.test(candidate.name))
  const selected = exactMatch

  if (!selected) {
    const expected = platform === 'darwin' ? `*-${arch}.dmg` : `*-windows-${arch}.exe`
    throw new Error(`未找到 ${platform}/${arch} 对应的安装包，需要匹配 ${expected}，且不支持 zip`)
  }

  const checksumCandidate = candidates.find((candidate) => candidate.name === 'SHA256SUMS.txt')
  if (!checksumCandidate) throw new Error('Release 缺少名为 SHA256SUMS.txt 的校验文件')

  return {
    asset: selected.asset,
    checksumAsset: checksumCandidate.asset
  }
}

function parseSha256Sums(text) {
  if (typeof text !== 'string') throw new Error('SHA256SUMS 内容必须是字符串')

  const checksums = new Map()
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue

    const hashToken = line.match(/^\S+/)?.[0]
    if (!hashToken || !SHA256_PATTERN.test(hashToken)) {
      throw new Error(`SHA256SUMS 第 ${index + 1} 行包含非法 hash`)
    }

    const match = line.match(/^([0-9a-fA-F]{64})[ \t]+\*?(.+)$/)
    if (!match || !match[2].trim()) {
      throw new Error(`SHA256SUMS 第 ${index + 1} 行格式无效，缺少文件名`)
    }

    const filename = match[2]
    const checksum = match[1].toLowerCase()
    if (checksums.has(filename) && checksums.get(filename) !== checksum) {
      throw new Error(`SHA256SUMS 第 ${index + 1} 行与文件 ${filename} 的校验值冲突`)
    }
    checksums.set(filename, checksum)
  }

  return checksums
}

function normalizeChecksum(value) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error('SHA256 校验值非法')
  }
  return value.toLowerCase()
}

function findExpectedChecksum(map, assetName) {
  if (!(map instanceof Map)) throw new Error('校验值必须是 Map')
  const safeName = sanitizeAssetName(assetName)

  if (map.has(safeName)) return normalizeChecksum(map.get(safeName))

  const matches = []
  for (const [filename, value] of map.entries()) {
    if (typeof filename === 'string' && filename.toLowerCase() === safeName.toLowerCase()) {
      matches.push(normalizeChecksum(value))
    }
  }

  if (matches.length === 0) throw new Error(`SHA256SUMS 中缺少文件 ${safeName} 的校验值`)
  const uniqueChecksums = [...new Set(matches)]
  if (uniqueChecksums.length > 1) {
    throw new Error(`SHA256SUMS 中存在文件名大小写冲突: ${safeName}`)
  }
  return uniqueChecksums[0]
}

function safeReleaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function toPublicReleaseInfo(release, selection, options = {}) {
  const { platform, arch } = assertPlatformAndArchitecture(options)
  const { currentVersion } = options || {}
  const tag = typeof release?.tag_name === 'string' ? release.tag_name.trim() : ''
  if (!tag) throw new Error('Release 缺少有效的 tag_name')

  const latestVersion = normalizeVersion(tag)
  const assetName = sanitizeAssetName(selection?.asset?.name)
  const rawSize = Number(selection?.asset?.size)
  const size = Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null

  return {
    latestVersion,
    tag,
    name: typeof release.name === 'string' ? release.name.slice(0, 200) : '',
    publishedAt:
      typeof release.published_at === 'string' ? release.published_at.slice(0, 100) : null,
    releaseUrl: safeReleaseUrl(release.html_url),
    notes: typeof release.body === 'string' ? release.body.slice(0, 20_000) : '',
    asset: {
      name: assetName,
      size
    },
    checksumAvailable: Boolean(selection?.checksumAsset),
    updateAvailable: isNewerVersion(latestVersion, currentVersion),
    installMode: platform === 'darwin' ? 'manual' : 'automatic',
    platform,
    arch,
    currentVersion: normalizeVersion(currentVersion)
  }
}

module.exports = {
  normalizeVersion,
  compareVersions,
  isNewerVersion,
  sanitizeAssetName,
  selectReleaseAsset,
  parseSha256Sums,
  findExpectedChecksum,
  toPublicReleaseInfo,
  safeReleaseUrl
}
