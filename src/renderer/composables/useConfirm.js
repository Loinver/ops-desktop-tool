import { opsApi } from '../api/opsApi.js'
export function useConfirm() {
  async function confirm(options) {
    return await opsApi.confirm(options)
  }

  return {
    confirm
  }
}
