const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const packageJson = require(path.join(root, 'package.json'))
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')

const testJob = workflow.slice(workflow.indexOf('  test:'), workflow.indexOf('  build:'))
const buildJob = workflow.slice(workflow.indexOf('  build:'), workflow.indexOf('  release-init:'))
const releaseInitJob = workflow.slice(
  workflow.indexOf('  release-init:'),
  workflow.indexOf('  mac-build:')
)
const macBuildJob = workflow.slice(
  workflow.indexOf('  mac-build:'),
  workflow.indexOf('  win-build:')
)
const winBuildJob = workflow.slice(workflow.indexOf('  win-build:'), workflow.indexOf('  release:'))
const releaseJob = workflow.slice(workflow.indexOf('  release:'))

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
  assert.match(workflow, /needs: \[mac-build, win-build, release-init\]/)

  assert.match(releaseInitJob, /- name: Create or resume draft GitHub Release/)
  assert.match(releaseInitJob, /gh api --method POST/)
  assert.match(releaseInitJob, /-F draft=true/)
  assert.match(releaseInitJob, /-F generate_release_notes=true/)
  assert.match(releaseInitJob, /not signed with an Apple Developer ID certificate/)

  assert.match(releaseJob, /gh release download "\$GITHUB_REF_NAME"/)
  assert.match(releaseJob, /--pattern 'checksums-\*\.txt'/)
  assert.match(releaseJob, /release\/SHA256SUMS\.txt/)
  assert.match(releaseJob, /gh release upload "\$GITHUB_REF_NAME" release\/SHA256SUMS\.txt/)
  assert.match(releaseJob, /gh release delete-asset/)
  assert.match(releaseJob, /gh release edit "\$GITHUB_REF_NAME"/)
  assert.match(releaseJob, /--draft=false/)
  assert.match(releaseJob, /--latest/)
  assert.doesNotMatch(releaseJob, /AppImage|\.deb/)
})

test('tag pushes are the only release trigger and publish source', () => {
  assert.match(workflow, /push:\n    branches: \[main\]\n    tags:\n      - ['"]v\*['"]/)
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

  assert.match(releaseInitJob, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(releaseInitJob, /-f tag_name="\$GITHUB_REF_NAME"/)
  assert.match(releaseJob, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
})

test('tag pushes validate the package version in the test job', () => {
  assert.match(testJob, /- name: Validate release tag version/)
  assert.match(testJob, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(testJob, /expected_tag="v\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/)
  assert.match(testJob, /if \[ "\$GITHUB_REF_NAME" != "\$expected_tag" \]/)
  assert.match(testJob, /must exactly match package\.json version tag/)
})

test('release assets bypass Actions artifact quota and publish through a draft release', () => {
  assert.doesNotMatch(buildJob, /actions\/upload-artifact@v4/)
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact@v4/)
  assert.doesNotMatch(workflow, /retention-days:/)

  assert.match(releaseInitJob, /- name: Create or resume draft GitHub Release/)
  assert.match(
    releaseInitJob,
    /Release \$GITHUB_REF_NAME is already published; refusing to overwrite its assets/
  )
  assert.match(releaseInitJob, /grep -Fq 'HTTP 404'/)
  assert.match(
    workflow,
    /concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n  cancel-in-progress: false/
  )

  assert.match(macBuildJob, /- name: Prepare Mac release assets and checksum fragment/)
  assert.match(macBuildJob, /checksums-mac-\$\{\{ matrix\.arch \}\}\.txt/)
  assert.match(macBuildJob, /- name: Upload Mac assets directly to draft release/)
  assert.match(macBuildJob, /gh release upload "\$GITHUB_REF_NAME"/)

  assert.match(winBuildJob, /- name: Prepare Windows release assets and checksum fragment/)
  assert.match(winBuildJob, /checksums-win-\$\{\{ matrix\.arch \}\}\.txt/)
  assert.match(winBuildJob, /- name: Upload Windows assets directly to draft release/)
  assert.match(winBuildJob, /gh release upload \$env:GITHUB_REF_NAME/)

  for (const job of [macBuildJob, winBuildJob]) {
    assert.match(job, /permissions:\n      contents: write/)
    assert.match(job, /needs: \[build, release-init\]/)
    assert.match(job, /startsWith\(github\.ref, 'refs\/tags\/v'\)/)
    assert.match(job, /needs\.release-init\.result == 'success'/)
    assert.doesNotMatch(job, /needs\.release-init\.result == 'skipped'/)
    assert.match(job, /--clobber/)
  }

  assert.match(releaseJob, /SHA256SUMS\.txt must contain exactly/)
  assert.match(releaseJob, /Missing checksum entry for \$asset/)
})
