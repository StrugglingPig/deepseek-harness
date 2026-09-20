/** Register DeepSeek with protocol selection and request-local settings and credentials. */
import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { LlmConfigurableProvider, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { DeepSeekAdapter } from './adapter.ts'
import { Config, resolveAdapterOptions } from './config.ts'
import type { ResolvedDeepSeekOptions } from './config.ts'

export { Config, resolveAdapterOptions, PUBLIC_BASE_URL, MESSAGES_BASE_URL } from './config.ts'
export type { ResolvedDeepSeekOptions } from './config.ts'
export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from './common/defaults.ts'
export { DeepSeekAdapter } from './adapter.ts'
export type { DeepSeekProtocol } from './common/types.ts'
export type { DeepSeekAdapterOptions, DeepSeekCatalogModel, DeepSeekConnectionOptions } from './common/types.ts'
export {
  DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  REQUEST_IMAGE_MAX_DIMENSION,
  deepSeekImageRequestPricing,
  resolveRequestImageMaxBytes,
  resolveRequestImageTarget,
} from './common/request-pricing.ts'
export { deepSeekImageTokens, deepSeekRequestImageDimensions } from './common/image-tokens.ts'
export { DeepSeekFileStore, MAX_IMAGE_BYTES } from './common/file-store.ts'
export type { DeepSeekFileConnection, DeepSeekFilePolicy, DeepSeekFileReference } from './common/file-store.ts'
export { DeepSeekFilesClient, MAX_FILE_EXPIRY_SECONDS, MAX_FILE_UPLOAD_BYTES, MAX_STORED_FILE_BYTES, MAX_STORED_FILE_COUNT, MIN_FILE_EXPIRY_SECONDS } from './common/files-api.ts'
export type { DeepSeekFileObject, DeepSeekFilePage } from './common/files-api.ts'
export { DeepSeekFileId } from './common/file-id.ts'
export type { DeepSeekFileId as DeepSeekFileIdType } from './common/file-id.ts'
export { DeepSeekUploadIndex, deepSeekFileScope } from './common/upload-index.ts'
export type { DeepSeekUploadRecord } from './common/upload-index.ts'
export type { RequestDefaults } from './common/types.ts'
export type * from './protocols/chat-completions/types.ts'

export const name = 'llm-deepseek'
export const inject = ['llm']

const NS = 'llm-deepseek'
const PROVIDER = 'deepseek-official'

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedDeepSeekOptions | undefined
  const options = (): ResolvedDeepSeekOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-deepseek: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  /**
   * Whether the current configuration withdraws this route. Read from the raw
   * snapshot rather than the resolved adapter options: the flag says whether
   * the route exists, so it is the one fact a settings write must be able to
   * read without the adapter facts resolving behind it.
   */
  const routeDisabled = (): boolean => current().disabled === true

  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
      }
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()
  const adapter = new DeepSeekAdapter({
    options,
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`llm-deepseek: unusable Messages replay state on assistant history for route "${provider}/${model}"; sending provider-neutral content (${reason})`)
    },
    resolveApiKey,
    resolveUserId,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    prepareExtensions: (request) => {
      const extensions = ctx.get('deepseekLlmApiExtensions')
      return extensions?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
    },
  })
  /**
   * The one directory entry this adapter owns; `disabled` follows the status
   * below rather than being read here, so the entry and the directory's own
   * status cannot disagree.
   */
  const directoryEntry = (disabled: boolean): LlmConfigurableProvider => ({
    provider: PROVIDER,
    displayName: 'DeepSeek',
    settingsNs: NS,
    settingsPath: [],
    ...disabled ? { disabled: true } : {},
  })
  // The composition decides the opening status; the settings section below
  // corrects it when this run's settings provider resolves a stored one.
  let directoryDisabled = routeDisabled()
  const directory = ctx.llm.registerConfigurableProviders([directoryEntry(directoryDisabled)])
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below.
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  /**
   * What the registration's route set holds right now, and the retry policy it
   * was last reconciled to. Both facts travel in one `replace`, because the
   * registry captures the policy at replacement time and it is the one fact
   * per-request resolution cannot refresh. Disposing and re-registering
   * instead would publish an empty route set between the two calls, and an
   * observer that reacted to it would see this provider disappear and come
   * back.
   *
   * The route is registered even when this composition starts withdrawn, then
   * emptied in the same synchronous section: `replace` refuses an empty set
   * for a registration that never held one, and that refusal is what
   * distinguishes "this route serves nothing" from "this route was never
   * offered". Applying the withdrawal here leaves both states reachable.
   */
  let routeHeld = true
  let registeredPolicy = options().retryPolicy
  if (directoryDisabled) {
    registration.replace([])
    routeHeld = false
  }
  /** The last facts this adapter reconciled the registration to. */
  let registrationFacts: { disabled: boolean; retryPolicy: ResolvedRetryPolicy } | undefined
  const ensureRegistrationFacts = (): void => {
    const disabled = routeDisabled()
    const { retryPolicy } = options()
    const desiredHolds = !disabled
    // A held set is refreshed when the policy moved; an empty one is left
    // alone, because emptying a set the registration does not hold is not a
    // state this route ever held and the registry refuses it outright.
    const policyMoved = routeHeld && !deepEqualJson(registeredPolicy, retryPolicy)
    if (desiredHolds !== routeHeld || policyMoved) {
      registration.replace(desiredHolds ? [PROVIDER] : [])
      routeHeld = desiredHolds
      registeredPolicy = retryPolicy
    }
    // The declaration outlives the route: it is the entry a configuration
    // surface lists in its add list while the route is withdrawn, and the one
    // its restore writes back to. Only the flag travels, so the entry is
    // republished when the withdrawal itself moved and not on every unrelated
    // settings write.
    if (registrationFacts === undefined || disabled !== registrationFacts.disabled) {
      directoryDisabled = disabled
      directory.replace([directoryEntry(disabled)])
    }
    registrationFacts = { disabled, retryPolicy }
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: ensureRegistrationFacts,
    })
  })
}
