const fs = require('node:fs')
const path = require('node:path')

const rendererRoot = path.resolve(__dirname, '../src/renderer')
const bridgeFile = path.join(rendererRoot, 'api/opsApi.js')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(entryPath)
    return /\.(js|vue)$/.test(entry.name) ? [entryPath] : []
  })
}

const violations = walk(rendererRoot).filter((file) => {
  return file !== bridgeFile && fs.readFileSync(file, 'utf8').includes('window.opsApi')
})

if (violations.length) {
  console.error('Renderer files must access IPC through src/renderer/api/opsApi.js:')
  violations.forEach((file) => console.error(`- ${path.relative(process.cwd(), file)}`))
  process.exit(1)
}

console.log('renderer IPC API boundary checks passed')
