const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const packageJson = require(path.join(root, 'package.json'))
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const smokeScriptPath = path.join(root, 'scripts', 'windows-packaged-app-smoke.cjs')
const smokeScript = fs.readFileSync(smokeScriptPath, 'utf8')
const { packagedExecutablePath, unpackedDirectoryName } = require(smokeScriptPath)

test('Windows 构建生成安装包和可直接启动的解压目录', () => {
  assert.deepEqual(packageJson.build.win.target, ['nsis', 'zip'])
  assert.match(packageJson.scripts['electron:build:win'], /electron-builder --win/)
  assert.equal(fs.existsSync(smokeScriptPath), true)
})

test('Windows CI 构建后会启动打包应用并上传安装产物', () => {
  assert.match(workflow, /runs-on: windows-latest/)
  assert.match(workflow, /run: pnpm electron:build:win/)
  assert.match(workflow, /node scripts\/windows-packaged-app-smoke\.cjs --arch=x64/)
  assert.match(workflow, /release\/\*\.exe/)
  assert.match(workflow, /release\/\*\.zip/)
})

test('Windows smoke test 使用正确架构目录、隔离数据目录并等待渲染进程主动退出', () => {
  assert.equal(unpackedDirectoryName('x64'), 'win-unpacked')
  assert.equal(unpackedDirectoryName('arm64'), 'win-arm64-unpacked')
  assert.equal(
    packagedExecutablePath('x64'),
    path.join(root, 'release', 'win-unpacked', 'Ops Desktop.exe')
  )
  assert.match(smokeScript, /win-unpacked/)
  assert.match(smokeScript, /--smoke-test/)
  assert.match(smokeScript, /--user-data-dir=/)
  assert.match(smokeScript, /OPS_DESKTOP_SMOKE_TEST/)
  assert.match(smokeScript, /child\.once\('exit'/)
})
