export function useConfirm() {
  async function confirm(options) {
    return await window.opsApi.confirm(options)
  }

  return {
    confirm
  }
}
