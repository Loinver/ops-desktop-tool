const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const packageJson = require(path.join(root, 'package.json'))
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')

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

test('distribution is limited to macOS and Windows without implicit publishing', () => {
  for (const scriptName of packageScripts) {
    assert.match(packageJson.scripts[scriptName], /--publish never/)
  }

  assert.equal(packageJson.scripts['electron:build'], undefined)
  assert.equal(packageJson.scripts['electron:build:linux'], undefined)
  assert.equal(packageJson.build.linux, undefined)

  assert.match(
    workflow,
    /pnpm exec electron-builder --mac --\$\{\{ matrix\.arch \}\} --config\.forceCodeSigning=true --publish never/
  )
  assert.doesNotMatch(workflow, /^  linux-build:/m)
  assert.doesNotMatch(workflow, /ops-desktop-linux/)
  assert.doesNotMatch(workflow, /AppImage|\.deb/)
  assert.match(workflow, /needs: \[mac-build, win-build\]/)

  assert.match(releasePublishStep, /uses: softprops\/action-gh-release@v2/)
  assert.match(releasePublishStep, /release\/\*\.dmg/)
  assert.match(releasePublishStep, /release\/\*\.zip/)
  assert.match(releasePublishStep, /release\/\*\.exe/)
  assert.doesNotMatch(releasePublishStep, /AppImage|\.deb/)
})
