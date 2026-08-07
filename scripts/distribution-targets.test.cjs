const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const packageJson = require(path.join(root, 'package.json'))
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')

const testJob = workflow.slice(workflow.indexOf('  test:'), workflow.indexOf('  build:'))
const macBuildJob = workflow.slice(
  workflow.indexOf('  mac-build:'),
  workflow.indexOf('  win-build:')
)
const releaseJob = workflow.slice(workflow.indexOf('  release:'))
const releasePublishStep = workflow.slice(workflow.indexOf('- name: Publish release artifacts'))

const packageScripts = [
  'electron:build:mac',
  'electron:build:mac:arm64',
  'electron:build:mac:x64',
  'electron:build:mac:release',
  'electron:build:win',
  'electron:build:win:x64',
  'electron:build:win:arm64'
]

const macPackageScripts = [
  'electron:build:mac',
  'electron:build:mac:arm64',
  'electron:build:mac:x64',
  'electron:build:mac:release'
]

test('distribution is limited to macOS and Windows without implicit publishing', () => {
  for (const scriptName of packageScripts) {
    assert.match(packageJson.scripts[scriptName], /--publish never/)
  }

  for (const scriptName of macPackageScripts) {
    assert.match(packageJson.scripts[scriptName], /--config\.mac\.notarize=false/)
    assert.doesNotMatch(packageJson.scripts[scriptName], /forceCodeSigning=true/)
  }

  assert.equal(packageJson.scripts['electron:build'], undefined)
  assert.equal(packageJson.scripts['electron:build:linux'], undefined)
  assert.equal(packageJson.build.linux, undefined)
  assert.equal(packageJson.build.mac.notarize, false)

  assert.match(workflow, /run: pnpm electron:build:mac:\$\{\{ matrix\.arch \}\}/)
  assert.doesNotMatch(workflow, /forceCodeSigning=true/)
  assert.doesNotMatch(workflow, /^  linux-build:/m)
  assert.doesNotMatch(workflow, /ops-desktop-linux/)
  assert.doesNotMatch(workflow, /AppImage|\.deb/)
  assert.match(workflow, /needs: \[mac-build, win-build\]/)

  assert.match(releasePublishStep, /uses: softprops\/action-gh-release@v2/)
  assert.match(releasePublishStep, /generate_release_notes: true/)
  assert.match(releasePublishStep, /not signed with an Apple Developer ID certificate/)
  assert.match(releasePublishStep, /release\/\*\.dmg/)
  assert.match(releasePublishStep, /release\/\*\.zip/)
  assert.match(releasePublishStep, /release\/\*\.exe/)
  assert.doesNotMatch(releasePublishStep, /AppImage|\.deb/)
})

test('tag pushes are the only release trigger and publish source', () => {
  assert.match(workflow, /push:\n    branches: \[main\]\n    tags:\n      - "v\*"/)
  assert.match(workflow, /pull_request:\n    branches: \[main\]/)
  assert.doesNotMatch(workflow, /^  release:\n    types: \[published\]/m)
  assert.doesNotMatch(
    workflow,
    /github\.event_name\s*={1,2}\s*['"]release['"]|github\.event\.release\.tag_name/
  )

  assert.match(macBuildJob, /- name: Warn about unsigned Mac release/)
  assert.match(macBuildJob, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(macBuildJob, /- name: Build Mac package without Developer ID signing/)
  assert.match(macBuildJob, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/)
  assert.doesNotMatch(
    macBuildJob,
    /Validate Mac release credentials|Build signed and notarized Mac package/
  )

  assert.match(releaseJob, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(releasePublishStep, /tag_name: \$\{\{ github\.ref_name \}\}/)
})

test('tag pushes validate the package version in the test job', () => {
  assert.match(testJob, /- name: Validate release tag version/)
  assert.match(testJob, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(testJob, /expected_tag="v\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/)
  assert.match(testJob, /if \[ "\$GITHUB_REF_NAME" != "\$expected_tag" \]/)
  assert.match(testJob, /must exactly match package\.json version tag/)
})
