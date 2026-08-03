const QUICK_LAUNCH_STORAGE_SCHEMA = 'ops-desktop.quick-launch'
const QUICK_LAUNCH_STORAGE_VERSION = 2

function readQuickLaunchState(value) {
  if (Array.isArray(value)) return { items: value }

  if (value && typeof value === 'object' && Array.isArray(value.items)) {
    return { items: value.items }
  }

  return { items: [] }
}

function makeQuickLaunchState(items) {
  return {
    schema: QUICK_LAUNCH_STORAGE_SCHEMA,
    version: QUICK_LAUNCH_STORAGE_VERSION,
    items: Array.isArray(items) ? items : []
  }
}

module.exports = {
  QUICK_LAUNCH_STORAGE_SCHEMA,
  QUICK_LAUNCH_STORAGE_VERSION,
  readQuickLaunchState,
  makeQuickLaunchState
}
