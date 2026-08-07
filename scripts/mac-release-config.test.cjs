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

test('macOS packaging uses supported Electron tooling and explicit unsigned distribution', () => {
  assert.ok(major(packageJson.devDependencies.electron) >= 43)
  assert.ok(major(packageJson.devDependencies['electron-builder']) >= 26)
  assert.equal(packageJson.engines.node, '>=22.12.0')

  const mac = packageJson.build.mac
  assert.deepEqual(mac.target, ['dmg', 'zip'])
  assert.equal(mac.artifactName, '${productName}-${version}-${arch}.${ext}')
  assert.equal(mac.hardenedRuntime, true)
  assert.equal(mac.notarize, false)

  for (const entitlement of [mac.entitlements, mac.entitlementsInherit]) {
    assert.ok(entitlement)
    assert.ok(fs.existsSync(path.join(root, entitlement)), `${entitlement} should exist`)
  }
})

test('macOS build scripts expose arm64, x64 and unsigned release targets', () => {
  assert.match(packageJson.scripts['electron:build:mac:arm64'], /--arm64/)
  assert.match(packageJson.scripts['electron:build:mac:x64'], /--x64/)
  assert.match(packageJson.scripts['electron:build:mac:release'], /--arm64 --x64/)

  for (const scriptName of [
    'electron:build:mac',
    'electron:build:mac:arm64',
    'electron:build:mac:x64',
    'electron:build:mac:release'
  ]) {
    assert.match(packageJson.scripts[scriptName], /--config\.mac\.notarize=false/)
    assert.doesNotMatch(packageJson.scripts[scriptName], /forceCodeSigning=true/)
  }
})

test('release workflow builds and smoke tests unsigned Mac artifacts for both architectures', () => {
  assert.match(workflow, /tags:\n      - "v\*"/)
  assert.doesNotMatch(workflow, /types: \[published\]/)
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
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
    assert.doesNotMatch(workflow, new RegExp(`secrets\\.${secret}(?:\\s|\\})`))
  }

  assert.match(workflow, /- name: Warn about unsigned Mac release/)
  assert.match(workflow, /not signed with Apple Developer ID and are not notarized/)
  assert.match(workflow, /- name: Build Mac package without Developer ID signing/)
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/)
  assert.doesNotMatch(workflow, /forceCodeSigning=true/)
  assert.doesNotMatch(workflow, /codesign --verify --deep --strict/)
  assert.doesNotMatch(workflow, /spctl --assess --type execute/)
  assert.doesNotMatch(workflow, /xcrun stapler validate/)
  assert.match(
    workflow,
    /node scripts\/mac-packaged-app-smoke\.cjs --arch=\$\{\{ matrix\.arch \}\}/
  )
  assert.match(workflow, /matrix\.executable_arch/)
  assert.match(workflow, /pattern: ops-desktop-mac-\*/)
  assert.equal(fs.existsSync(path.join(root, '.github', 'workflows', 'code-signing.yml')), false)
})
