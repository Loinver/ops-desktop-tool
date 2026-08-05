const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const packageJson = require(path.join(root, 'package.json'))
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8')

function major(versionRange) {
  const match = String(versionRange).match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

test('macOS packaging uses supported Electron tooling and hardened runtime', () => {
  assert.ok(major(packageJson.devDependencies.electron) >= 43)
  assert.ok(major(packageJson.devDependencies['electron-builder']) >= 26)
  assert.equal(packageJson.engines.node, '>=22.12.0')

  const mac = packageJson.build.mac
  assert.deepEqual(mac.target, ['dmg', 'zip'])
  assert.equal(mac.artifactName, '${productName}-${version}-${arch}.${ext}')
  assert.equal(mac.hardenedRuntime, true)
  assert.equal(mac.notarize, true)

  for (const entitlement of [mac.entitlements, mac.entitlementsInherit]) {
    assert.ok(entitlement)
    assert.ok(fs.existsSync(path.join(root, entitlement)), `${entitlement} should exist`)
  }
})

test('macOS build scripts expose arm64, x64 and signed release targets', () => {
  assert.match(packageJson.scripts['electron:build:mac:arm64'], /--arm64/)
  assert.match(packageJson.scripts['electron:build:mac:x64'], /--x64/)
  assert.match(packageJson.scripts['electron:build:mac:release'], /--arm64 --x64/)
  assert.match(packageJson.scripts['electron:build:mac:release'], /forceCodeSigning=true/)
})

test('release workflow signs, notarizes and verifies both Mac architectures', () => {
  assert.match(workflow, /types: \[published\]/)
  assert.match(workflow, /node-version: '24'/)
  assert.doesNotMatch(workflow, /node-version: '20'/)
  assert.match(workflow, /os: macos-15/)
  assert.match(workflow, /os: macos-15-intel/)
  assert.match(workflow, /executable_arch: arm64/)
  assert.match(workflow, /executable_arch: x86_64/)

  for (const secret of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID'
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`))
  }

  assert.match(workflow, /forceCodeSigning=true/)
  assert.match(workflow, /codesign --verify --deep --strict/)
  assert.match(workflow, /spctl --assess --type execute/)
  assert.match(workflow, /xcrun stapler validate/)
  assert.match(workflow, /node scripts\/mac-packaged-app-smoke\.cjs/)
  assert.match(workflow, /matrix\.executable_arch/)
  assert.match(workflow, /pattern: ops-desktop-mac-\*/)
  assert.equal(fs.existsSync(path.join(root, '.github', 'workflows', 'code-signing.yml')), false)
})
