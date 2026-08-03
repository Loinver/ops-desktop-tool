function resolveOpsApi() {
  const api = typeof window === 'undefined' ? null : window.opsApi
  if (!api) {
    throw new Error('Ops Desktop IPC API is unavailable. Restart the application and try again.')
  }
  return api
}

/**
 * Renderer-side entry point for the context-isolated preload bridge.
 *
 * The proxy resolves the bridge at call time so test environments can attach a
 * mock after modules have been imported, while production keeps a single,
 * explicit dependency boundary for all IPC calls.
 */
export const opsApi = new Proxy(
  {},
  {
    get(_target, property) {
      const api = resolveOpsApi()
      const value = api[property]
      return typeof value === 'function' ? value.bind(api) : value
    }
  }
)
