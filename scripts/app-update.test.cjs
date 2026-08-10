const assert = require('node:assert/strict')
const test = require('node:test')

const {
  compareVersions,
  findExpectedChecksum,
  isNewerVersion,
  normalizeVersion,
  parseSha256Sums,
  safeReleaseUrl,
  sanitizeAssetName,
  selectReleaseAsset,
  toPublicReleaseInfo
} = require('../src/main/utils/app-update')

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function asset(name, size = 123) {
  return {
    name,
    size,
    url: `https://api.github.com/assets/${encodeURIComponent(name)}`,
    browser_download_url: `https://github.com/example/app/releases/download/v2.0.0/${encodeURIComponent(name)}`
  }
}

function releaseWithAssets(assets) {
  return {
    tag_name: 'v2.0.0+build.7',
    name: 'Ops Desktop 2.0.0',
    body: '修复更新流程。',
    published_at: '2026-08-07T00:00:00Z',
    html_url: 'https://github.com/example/app/releases/tag/v2.0.0',
    assets
  }
}

test('normalizes versions and compares stable and prerelease versions', () => {
  assert.equal(normalizeVersion('  v1.2.3-beta.2+build.9  '), '1.2.3-beta.2')
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
  assert.equal(compareVersions('1.0.0-alpha.10', '1.0.0-alpha.2'), 1)
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-alpha.9'), 1)
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('v1.0.0+one', '1.0.0+two'), 0)
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), true)
  assert.equal(isNewerVersion('2.0.0-beta.1', '2.0.0-beta.2'), false)
  assert.throws(() => compareVersions('1.2', '1.0.0'), /无效版本号/)
})

test('sanitizes asset names and rejects traversal, controls, and empty names', () => {
  assert.equal(sanitizeAssetName('  Ops Desktop-arm64.dmg  '), 'Ops Desktop-arm64.dmg')
  for (const value of [
    '',
    '   ',
    '../app.dmg',
    'nested/app.dmg',
    '..\\app.dmg',
    'app\n.dmg',
    '..'
  ]) {
    assert.throws(() => sanitizeAssetName(value), /资产文件名/)
  }
})

test('selects exact macOS architecture assets and checksum asset', () => {
  const release = releaseWithAssets([
    asset('Ops Desktop-arm64.dmg'),
    asset('Ops Desktop-x64.dmg'),
    asset('Ops Desktop-arm64.zip'),
    asset('SHA256SUMS.txt')
  ])

  assert.equal(
    selectReleaseAsset(release, { platform: 'darwin', arch: 'arm64' }).asset.name,
    'Ops Desktop-arm64.dmg'
  )
  assert.equal(
    selectReleaseAsset(release, { platform: 'darwin', arch: 'x64' }).asset.name,
    'Ops Desktop-x64.dmg'
  )
})

test('selects exact Windows architecture assets and never selects zip', () => {
  const release = releaseWithAssets([
    asset('Ops Desktop-windows-arm64.exe'),
    asset('Ops Desktop-windows-x64.exe'),
    asset('Ops Desktop-windows-arm64.zip'),
    asset('SHA256SUMS.txt')
  ])

  assert.equal(
    selectReleaseAsset(release, { platform: 'win32', arch: 'arm64' }).asset.name,
    'Ops Desktop-windows-arm64.exe'
  )
  assert.equal(
    selectReleaseAsset(release, { platform: 'win32', arch: 'x64' }).asset.name,
    'Ops Desktop-windows-x64.exe'
  )
})

test('reports missing installer and checksum assets clearly', () => {
  assert.throws(
    () =>
      selectReleaseAsset(releaseWithAssets([asset('Ops Desktop-arm64.zip')]), {
        platform: 'darwin',
        arch: 'arm64'
      }),
    /未找到.*安装包.*不支持 zip/
  )
  assert.throws(
    () =>
      selectReleaseAsset(releaseWithAssets([asset('Ops Desktop-arm64.dmg')]), {
        platform: 'darwin',
        arch: 'arm64'
      }),
    /缺少.*SHA256SUMS\.txt/
  )
  assert.throws(
    () =>
      selectReleaseAsset(
        releaseWithAssets([asset('Ops Desktop-arm64.dmg'), asset('SHA256SUMS.txt')]),
        { platform: 'linux', arch: 'x64' }
      ),
    /不支持的平台/
  )
})

test('requires the exact versioned product installer when a release version is supplied', () => {
  const release = releaseWithAssets([
    asset('Other Product-2.0.0-arm64.dmg'),
    asset('Ops Desktop-1.9.9-arm64.dmg'),
    asset('Ops Desktop-2.0.0-arm64.dmg'),
    asset('SHA256SUMS.txt')
  ])

  assert.equal(
    selectReleaseAsset(release, {
      platform: 'darwin',
      arch: 'arm64',
      version: '2.0.0'
    }).asset.name,
    'Ops Desktop-2.0.0-arm64.dmg'
  )
  assert.throws(
    () =>
      selectReleaseAsset(
        releaseWithAssets([
          asset('Other Product-2.0.0-arm64.dmg'),
          asset('Ops Desktop-1.9.9-arm64.dmg'),
          asset('SHA256SUMS.txt')
        ]),
        { platform: 'darwin', arch: 'arm64', version: '2.0.0' }
      ),
    /未找到.*安装包/
  )

  assert.equal(
    selectReleaseAsset(
      releaseWithAssets([asset('Ops.Desktop-2.0.0-arm64.dmg'), asset('SHA256SUMS.txt')]),
      { platform: 'darwin', arch: 'arm64', version: '2.0.0' }
    ).asset.name,
    'Ops.Desktop-2.0.0-arm64.dmg'
  )

  assert.equal(
    selectReleaseAsset(
      releaseWithAssets([asset('Ops.Desktop-2.0.0-windows-x64.exe'), asset('SHA256SUMS.txt')]),
      { platform: 'win32', arch: 'x64', version: '2.0.0' }
    ).asset.name,
    'Ops.Desktop-2.0.0-windows-x64.exe'
  )
})

test('supports Electron Builder space-separated asset names before GitHub normalization', () => {
  const release = releaseWithAssets([
    asset('Ops Desktop-1.0.6-x64.dmg'),
    asset('Ops Desktop-1.0.6-x64.zip'),
    asset('SHA256SUMS.txt')
  ])

  assert.equal(
    selectReleaseAsset(release, {
      platform: 'darwin',
      arch: 'x64',
      version: 'v1.0.6'
    }).asset.name,
    'Ops Desktop-1.0.6-x64.dmg'
  )
})

test('only exposes trusted GitHub release URLs', () => {
  assert.equal(
    safeReleaseUrl('https://github.com/example/app/releases/tag/v2.0.0?download=1#notes'),
    'https://github.com/example/app/releases/tag/v2.0.0'
  )
  assert.equal(safeReleaseUrl('https://example.com/releases/tag/v2.0.0'), null)
  assert.equal(safeReleaseUrl('https://token@github.com/example/app/releases/tag/v2.0.0'), null)
  assert.equal(safeReleaseUrl('javascript:alert(1)'), null)
})

test('parses sha256sum lines with filenames containing spaces', () => {
  const map = parseSha256Sums(`${HASH_A}  Ops Desktop-arm64.dmg\n${HASH_B} *Other Package.exe\n`)
  assert.equal(map.get('Ops Desktop-arm64.dmg'), HASH_A)
  assert.equal(map.get('Other Package.exe'), HASH_B)
  assert.equal(findExpectedChecksum(map, 'Ops Desktop-arm64.dmg'), HASH_A)
  assert.equal(
    findExpectedChecksum(new Map([['ops desktop-arm64.dmg', HASH_A]]), 'Ops Desktop-arm64.dmg'),
    HASH_A
  )
  assert.equal(findExpectedChecksum(map, 'Ops.Desktop-arm64.dmg'), HASH_A)
})

test('rejects invalid hashes and conflicting duplicate checksum entries', () => {
  assert.throws(() => parseSha256Sums(`not-a-hash  app.dmg`), /非法 hash/)
  assert.throws(() => parseSha256Sums(`${HASH_A}  app.dmg\n${HASH_B}  app.dmg`), /校验值冲突/)
  assert.throws(() => findExpectedChecksum(new Map(), 'missing.dmg'), /缺少文件/)
  assert.throws(
    () =>
      findExpectedChecksum(
        new Map([
          ['Ops Desktop-arm64.dmg', HASH_A],
          ['Ops.Desktop-arm64.dmg', HASH_B]
        ]),
        'Ops.Desktop-arm64.dmg'
      ),
    /别名或大小写冲突/
  )
})

test('returns a public release summary without asset URLs or tokens', () => {
  const release = releaseWithAssets([asset('Ops Desktop-arm64.dmg'), asset('SHA256SUMS.txt')])
  const selection = selectReleaseAsset(release, { platform: 'darwin', arch: 'arm64' })
  const summary = toPublicReleaseInfo(release, selection, {
    currentVersion: '1.9.0',
    platform: 'darwin',
    arch: 'arm64'
  })

  assert.deepEqual(summary.asset, { name: 'Ops Desktop-arm64.dmg', size: 123 })
  assert.equal(summary.latestVersion, '2.0.0')
  assert.equal(summary.tag, 'v2.0.0+build.7')
  assert.equal(summary.releaseUrl, 'https://github.com/example/app/releases/tag/v2.0.0')
  assert.equal(summary.checksumAvailable, true)
  assert.equal(summary.updateAvailable, true)
  assert.equal(summary.installMode, 'manual')
  assert.equal(summary.platform, 'darwin')
  assert.equal(summary.arch, 'arm64')
  assert.equal(summary.currentVersion, '1.9.0')
  assert.equal('url' in summary, false)
  assert.equal('url' in summary.asset, false)
  assert.equal('browser_download_url' in summary.asset, false)
})
