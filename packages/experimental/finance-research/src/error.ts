/** Stable finance provider failures shared by the transport and auth layers. */

/** One provider failure with a stable machine-routable code. */
export class FinanceDataError extends Error {
  /**
   * @param message - Human-readable failure detail.
   * @param code - Stable provider error code.
   */
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'FinanceDataError'
  }
}
