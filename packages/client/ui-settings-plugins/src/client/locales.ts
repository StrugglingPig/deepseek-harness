/** Locale bundles for the built-in plugins settings section and the plugin configuration pages. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchApiKey' | 'webSearchApiKeyHint' | 'webSearchApiKeySet' | 'webSearchApiKeyUnset'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'
  | 'subagentTitle' | 'subagentDescription' | 'subagentLimitsTitle'
  | 'subagentMaxDepth'
  | 'subagentDepthHelpLabel' | 'subagentDepthHelp'
  | 'subagentDepthZero' | 'subagentDepthOne' | 'subagentDepthOverride'
  | 'subagentMaxActive'
  | 'subagentCapacityHelpLabel' | 'subagentCapacityHelp'
  | 'subagentDepthInvalid'
  | 'subagentCapacityInvalid'
  | 'subagentModelSelectionTitle'
  | 'subagentModelSelectionToggle' | 'subagentModelSelectionChoose' | 'subagentModelSelectionAllowed'
  | 'subagentModelSelectionLoading' | 'subagentModelSelectionLoadFailed' | 'subagentModelSelectionRetry'
  | 'subagentModelSelectionPartial' | 'subagentModelSelectionUnavailable'
  | 'subagentModelSelectionUnavailableGroup' | 'subagentModelSelectionEmpty'
  | 'subagentModelSelectionRequired' | 'subagentModelSelectionConflict' | 'subagentModelSelectionOff'
  | 'financeTitle' | 'financeDescription' | 'financeSecurityNote'
  | 'financeProvider' | 'financeProviderHint' | 'financeProviderFixture' | 'financeProviderHttp'
  | 'financeTimeoutMs' | 'financeTimeoutMsHint'
  | 'financeBarLimit' | 'financeBarLimitHint'
  | 'financeYahooBaseUrl' | 'financeBinanceSpotBaseUrl' | 'financeBinanceUsdmBaseUrl'
  | 'financeBinanceCoinmBaseUrl' | 'financeBinanceOptionsBaseUrl'
  | 'financePolymarketGammaBaseUrl' | 'financePolymarketClobBaseUrl' | 'financeEndpointHint'
  | 'financeEnableSignedRequests' | 'financeEnableSignedRequestsHint'
  | 'financeCoinMarketCapTitle' | 'financeEnableCoinMarketCapRequests' | 'financeEnableCoinMarketCapRequestsHint'
  | 'financeCoinMarketCapBaseUrl' | 'financeCoinMarketCapWebSocketBaseUrl'
  | 'financeCoinMarketCapApiKey' | 'financeCoinMarketCapApiKeyHint'
  | 'financeCoinGeckoTitle' | 'financeEnableCoinGeckoRequests' | 'financeEnableCoinGeckoRequestsHint'
  | 'financeCoinGeckoBaseUrl' | 'financeCoinGeckoApiKey' | 'financeCoinGeckoApiKeyHint'
  | 'financeGithubToken' | 'financeGithubTokenHint'
  | 'financeAlphaVantageTitle' | 'financeEnableAlphaVantageRequests' | 'financeEnableAlphaVantageRequestsHint'
  | 'financeAlphaVantageBaseUrl' | 'financeAlphaVantageApiKey' | 'financeAlphaVantageApiKeyHint'
  | 'financeFredTitle' | 'financeEnableFredRequests' | 'financeEnableFredRequestsHint'
  | 'financeFredBaseUrl' | 'financeFredApiKey' | 'financeFredApiKeyHint' | 'financeFredApiKeyLink'
  | 'financeStockTitle' | 'financeEnableAkshare' | 'financeEnableAkshareHint'
  | 'financeEnableIfind' | 'financeEnableIfindHint'
  | 'financeIfindTransport' | 'financeIfindTransportHint'
  | 'financeIfindTransportHttp' | 'financeIfindTransportLocal'
  | 'financeIfindBaseUrl' | 'financeIfindBaseUrlHint'
  | 'financePythonExecutable' | 'financePythonExecutableHint'
  | 'financeStockBridgeTimeoutMs' | 'financeStockBridgeTimeoutMsHint'
  | 'financeStockBridgeMaxOutputBytes' | 'financeStockBridgeMaxOutputBytesHint'
  | 'financeIfindUser' | 'financeIfindUserHint' | 'financeIfindPassword' | 'financeIfindPasswordHint'
  | 'financeIfindRefreshToken' | 'financeIfindRefreshTokenHint'
  | 'financeBinanceApiKey' | 'financeBinanceApiKeyHint'
  | 'financeBinanceApiSecret' | 'financeBinanceApiSecretHint'
  | 'financeCredentialSet' | 'financeCredentialUnset'
  | 'financeDeliveryTitle' | 'financeBinanceWebSocketBaseUrl'
  | 'financeMarketStreamTimeoutMs' | 'financeMarketStreamTimeoutMsHint'
  | 'financeMarketStreamMaxEvents' | 'financeMarketStreamMaxEventsHint'
  | 'financeTransportTitle'
  | 'financeRequestCacheTtlMs' | 'financeRequestCacheTtlMsHint'
  | 'financeRequestCacheMaxEntries' | 'financeRequestCacheMaxEntriesHint'
  | 'financeRequestMaxRetries' | 'financeRequestMaxRetriesHint'
  | 'financeRequestRetryBaseDelayMs' | 'financeRequestRetryBaseDelayMsHint'
  | 'financeRequestRetryMaxDelayMs' | 'financeRequestRetryMaxDelayMsHint'
  | 'financeRequestsPerMinute' | 'financeRequestsPerMinuteHint'
  | 'financeRequestBurst' | 'financeRequestBurstHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Built-in plugins',
  title: 'Built-in plugins',
  intro: 'Inspect the plugins this deployment ships.',
  tabs: 'Plugin views',
  empty: 'This deployment exposes no plugin views.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'The DeepSeek search provider.',
  webSearchApiKey: 'API key',
  webSearchApiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  webSearchApiKeySet: 'A key is configured.',
  webSearchApiKeyUnset: 'No key is configured; search is unavailable until one is.',
  webSearchBaseUrl: 'Endpoint',
  webSearchBaseUrlHint: 'Leave blank to use the provider default.',
  webSearchMaxUses: 'Max searches per request',
  webSearchMaxUsesHint: 'How many times one request may search before it must answer.',
  subagentTitle: 'Subagent',
  subagentDescription: 'Set Subagent recursion depth, count, and models.',
  subagentLimitsTitle: 'Limits',
  subagentMaxDepth: 'Maximum recursion depth',
  subagentDepthHelpLabel: 'About maximum recursion depth',
  subagentDepthHelp: 'Limits how many levels of Subagents an Agent can create.',
  subagentDepthZero: 'Disable Subagents',
  subagentDepthOne: 'Only the main Agent can create Subagents',
  subagentDepthOverride: 'If a tool defines its own maximum recursion depth, that setting takes precedence.',
  subagentMaxActive: 'Subagent parallelism limit',
  subagentCapacityHelpLabel: 'About the Subagent parallelism limit',
  subagentCapacityHelp: 'Total live Subagents under the same main Agent, across all recursion levels. The main Agent is excluded. New start requests are rejected when the limit is reached.',
  subagentDepthInvalid: 'Enter a whole number of 0 or more.',
  subagentCapacityInvalid: 'Enter a whole number of 1 or more.',
  subagentModelSelectionTitle: 'Model selection',
  subagentModelSelectionToggle: 'Allow agents to choose models for Subagents',
  subagentModelSelectionChoose: 'When enabled, agents can choose a provider, model, and reasoning effort for each Subagent from the authorized models below. Applies only to new sessions.',
  subagentModelSelectionAllowed: 'Models agents may choose',
  subagentModelSelectionLoading: 'Loading models…',
  subagentModelSelectionLoadFailed: 'Models could not be loaded.',
  subagentModelSelectionRetry: 'Retry',
  subagentModelSelectionPartial: 'Some model providers could not be loaded; saved choices remain removable.',
  subagentModelSelectionUnavailable: 'Currently unavailable',
  subagentModelSelectionUnavailableGroup: 'Saved but currently unavailable',
  subagentModelSelectionEmpty: 'No model provider currently advertises a model.',
  subagentModelSelectionRequired: 'Select at least one model before saving.',
  subagentModelSelectionConflict: 'Settings changed elsewhere. Discard your draft and try again.',
  subagentModelSelectionOff: 'Subagents use configured defaults or inherit the parent agent\'s model. Saved model choices are retained.',
  financeTitle: 'Finance research',
  financeDescription: 'Provider endpoints, limits, and write-only Binance credentials.',
  financeSecurityNote: 'API keys and secrets are stored by the credential service, never in this settings file. The model only asks for signed requests; it never receives the credentials.',
  financeProvider: 'Provider',
  financeProviderHint: 'fixture uses deterministic local data; http uses the configured public endpoints.',
  financeProviderFixture: 'fixture',
  financeProviderHttp: 'http',
  financeTimeoutMs: 'Request timeout (ms)',
  financeTimeoutMsHint: 'Per-request timeout for live provider calls.',
  financeBarLimit: 'History bar limit',
  financeBarLimitHint: 'Maximum bars requested by normalized snapshot loads.',
  financeYahooBaseUrl: 'Yahoo Finance base URL',
  financeBinanceSpotBaseUrl: 'Binance Spot base URL',
  financeBinanceUsdmBaseUrl: 'Binance USD-M base URL',
  financeBinanceCoinmBaseUrl: 'Binance COIN-M base URL',
  financeBinanceOptionsBaseUrl: 'Binance Options base URL',
  financePolymarketGammaBaseUrl: 'Polymarket Gamma base URL',
  financePolymarketClobBaseUrl: 'Polymarket CLOB base URL',
  financeEndpointHint: 'Leave blank to use the deployment default.',
  financeEnableSignedRequests: 'Allow signed Binance requests',
  financeEnableSignedRequestsHint: 'When enabled, a request explicitly marked signed is authenticated on the Host with the stored Binance credentials.',
  financeCoinMarketCapTitle: 'CoinMarketCap',
  financeEnableCoinMarketCapRequests: 'Allow CoinMarketCap API requests',
  financeEnableCoinMarketCapRequestsHint: 'When enabled, Host-side CoinMarketCap REST and WebSocket requests use the stored API key.',
  financeCoinMarketCapBaseUrl: 'CoinMarketCap Pro REST base URL',
  financeCoinMarketCapWebSocketBaseUrl: 'CoinMarketCap WebSocket URL',
  financeCoinMarketCapApiKey: 'CoinMarketCap API key',
  financeCoinGeckoTitle: 'CoinGecko community data',
  financeEnableCoinGeckoRequests: 'Read CoinGecko community and developer data',
  financeEnableCoinGeckoRequestsHint: 'Requires a free CoinGecko demo API key. Reports quote community and developer counts for crypto instruments only.',
  financeCoinGeckoBaseUrl: 'CoinGecko API origin',
  financeCoinGeckoApiKey: 'CoinGecko demo API key',
  financeCoinGeckoApiKeyHint: 'Free key from coingecko.com/en/developers/dashboard. Stored like every other finance credential.',
  financeGithubToken: 'GitHub token (optional)',
  financeGithubTokenHint: 'Optional. Public repositories are read without a token; a token only raises the 60-per-hour shared limit.',
  financeAlphaVantageTitle: 'Alpha Vantage US fundamentals',
  financeEnableAlphaVantageRequests: 'Read Alpha Vantage US equity fundamentals',
  financeEnableAlphaVantageRequestsHint: 'Adds P/E, P/B, margins, growth, sector, and industry to US equity reports. Needs a free Alpha Vantage key.',
  financeAlphaVantageBaseUrl: 'Alpha Vantage API origin',
  financeAlphaVantageApiKey: 'Alpha Vantage API key',
  financeAlphaVantageApiKeyHint: 'Free key from alphavantage.co/support/#api-key. The free tier allows 25 requests per day.',

  financeFredTitle: 'Macro data (FRED)',
  financeEnableFredRequests: 'Allow FRED macro requests',
  financeEnableFredRequestsHint: 'FRED carries the long US macro history: rates, credit spreads, PCE, payrolls, and the dollar. It needs a free FRED API key.',
  financeFredBaseUrl: 'FRED API base URL',
  financeFredApiKey: 'FRED API key',
  financeFredApiKeyHint: 'Stored on the Host and never returned to the model.',
  financeFredApiKeyLink: 'Request a free FRED API key',
  financeCoinMarketCapApiKeyHint: 'Write-only. Stored outside settings; leave blank to keep the current key.',
  financeStockTitle: 'A-share stock bridge',
  financeEnableAkshare: 'Enable AKShare stock data',
  financeEnableAkshareHint: 'Requires the Python package akshare in the configured interpreter.',
  financeEnableIfind: 'Enable Tonghuashun iFinD stock data',
  financeEnableIfindHint: 'Requires an authorized iFinD account. HTTP API needs a refresh token; local SDK needs the vendor SDK.',
  financeIfindTransport: 'iFinD transport',
  financeIfindTransportHint: 'http uses the Tonghuashun HTTP API; local uses the vendor iFinDPy SDK.',
  financeIfindTransportHttp: 'HTTP API',
  financeIfindTransportLocal: 'Local SDK',
  financeIfindBaseUrl: 'iFinD HTTP API base URL',
  financeIfindBaseUrlHint: 'Base origin for the Tonghuashun iFinD HTTP API.',
  financePythonExecutable: 'Python executable',
  financePythonExecutableHint: 'Interpreter used to run the bundled stock bridge.',
  financeStockBridgeTimeoutMs: 'Stock bridge timeout (ms)',
  financeStockBridgeTimeoutMsHint: 'Maximum time for one AKShare or iFinD request.',
  financeStockBridgeMaxOutputBytes: 'Stock bridge output cap (bytes)',
  financeStockBridgeMaxOutputBytesHint: 'Maximum captured output per bridge stream.',
  financeIfindUser: 'iFinD account',
  financeIfindUserHint: 'Write-only. Stored outside settings; leave blank to keep the current account.',
  financeIfindPassword: 'iFinD password',
  financeIfindPasswordHint: 'Write-only. Stored outside settings; leave blank to keep the current password.',
  financeIfindRefreshToken: 'iFinD refresh token',
  financeIfindRefreshTokenHint: 'Write-only. Used by the HTTP API transport; leave blank to keep the current token.',
  financeBinanceApiKey: 'Binance API key',
  financeBinanceApiKeyHint: 'Write-only. Stored outside settings; leave blank to keep the current key.',
  financeBinanceApiSecret: 'Binance API secret',
  financeBinanceApiSecretHint: 'Write-only. Stored outside settings; leave blank to keep the current secret.',
  financeCredentialSet: 'Configured',
  financeCredentialUnset: 'Not configured',
  financeDeliveryTitle: 'Realtime and monitoring',
  financeBinanceWebSocketBaseUrl: 'Binance WebSocket base URL',
  financeMarketStreamTimeoutMs: 'Realtime stream timeout (ms)',
  financeMarketStreamTimeoutMsHint: 'Maximum wait for one realtime event collection.',
  financeMarketStreamMaxEvents: 'Max events per collection',
  financeMarketStreamMaxEventsHint: 'Maximum realtime messages returned by one collection.',
  financeTransportTitle: 'Cache, rate limit, and retry',
  financeRequestCacheTtlMs: 'Cache TTL (ms)',
  financeRequestCacheTtlMsHint: 'Public GET cache lifetime; signed requests are never cached.',
  financeRequestCacheMaxEntries: 'Cache entry limit',
  financeRequestCacheMaxEntriesHint: 'Maximum public GET responses retained in memory.',
  financeRequestMaxRetries: 'Maximum retries',
  financeRequestMaxRetriesHint: 'Retries after the initial failed request.',
  financeRequestRetryBaseDelayMs: 'Initial retry delay (ms)',
  financeRequestRetryBaseDelayMsHint: 'Initial delay for bounded exponential backoff.',
  financeRequestRetryMaxDelayMs: 'Maximum retry delay (ms)',
  financeRequestRetryMaxDelayMsHint: 'Upper bound for bounded exponential backoff.',
  financeRequestsPerMinute: 'Requests per minute',
  financeRequestsPerMinuteHint: 'Shared token-bucket refill rate for each upstream origin.',
  financeRequestBurst: 'Request burst limit',
  financeRequestBurstHint: 'Maximum burst capacity accumulated by the token bucket.',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '内置插件',
  title: '内置插件',
  intro: '查看内置部署的插件列表',
  tabs: '插件视图',
  empty: '本部署没有开放任何插件视图。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  bashTitle: '终端',
  bashDescription: '限制 agent 运行的每一条命令。',
  bashTimeoutMs: '命令超时（毫秒）',
  bashTimeoutMsHint: '单条命令允许运行多久，超时即终止。',
  bashMaxOutputBytes: '单流输出上限（字节）',
  bashMaxOutputBytesHint: '超出部分会转存到临时文件，而不是被丢弃。',
  agentLoopTitle: 'Agent 循环',
  agentLoopDescription: 'Agent 如何派发工具调用。',
  agentLoopMaxParallel: '并行工具调用数',
  agentLoopMaxParallelHint: '同一步内最多同时运行多少个可并行的调用。',
  webSearchTitle: '网页搜索',
  webSearchDescription: 'DeepSeek 搜索提供方。',
  webSearchApiKey: 'API Key',
  webSearchApiKeyHint: '不写入设置文件。留空表示保持当前密钥。',
  webSearchApiKeySet: '已配置密钥。',
  webSearchApiKeyUnset: '未配置密钥；配置之前搜索不可用。',
  webSearchBaseUrl: '接口地址',
  webSearchBaseUrlHint: '留空则使用提供方默认地址。',
  webSearchMaxUses: '单次请求最多搜索次数',
  webSearchMaxUsesHint: '一次请求在必须作答前最多可以搜索多少次。',
  subagentTitle: 'Subagent',
  subagentDescription: '设置 Subagent 的递归层级、数量和模型。',
  subagentLimitsTitle: '运行限制',
  subagentMaxDepth: '最大递归深度',
  subagentDepthHelpLabel: '最大递归深度说明',
  subagentDepthHelp: '限制 Agent 创建 Subagent 的递归层级。',
  subagentDepthZero: '禁用 Subagent',
  subagentDepthOne: '仅允许主 Agent 创建 Subagent',
  subagentDepthOverride: '如果某个工具单独设置了最大递归深度，以该工具的设置为准。',
  subagentMaxActive: 'Subagent 并行数量上限',
  subagentCapacityHelpLabel: 'Subagent 并行数量上限说明',
  subagentCapacityHelp: '同一主 Agent 下，所有递归层级同时存活的 Subagent 总数，主 Agent 不计入。达到上限时，新的启动请求会被拒绝。',
  subagentDepthInvalid: '请输入不小于 0 的整数。',
  subagentCapacityInvalid: '请输入不小于 1 的整数。',
  subagentModelSelectionTitle: '模型选择',
  subagentModelSelectionToggle: '允许 Agent 为 Subagent 选择模型',
  subagentModelSelectionChoose: '开启后，Agent 可以从下方授权模型中，为每个 Subagent 选择提供方、模型和推理强度。仅影响新会话。',
  subagentModelSelectionAllowed: 'Agent 可选择的模型',
  subagentModelSelectionLoading: '正在加载模型…',
  subagentModelSelectionLoadFailed: '无法加载模型。',
  subagentModelSelectionRetry: '重试',
  subagentModelSelectionPartial: '部分模型提供方暂时无法加载；已保存的选择仍可移除。',
  subagentModelSelectionUnavailable: '当前不可用',
  subagentModelSelectionUnavailableGroup: '已保存但当前不可用',
  subagentModelSelectionEmpty: '当前没有模型提供方公布模型。',
  subagentModelSelectionRequired: '保存前请至少选择一个模型。',
  subagentModelSelectionConflict: '设置已在其他位置更新。请放弃修改后重试。',
  subagentModelSelectionOff: '关闭后，Subagent 使用配置的默认模型或继承父 Agent 的模型；已选模型会保留。',
  financeTitle: '金融研究',
  financeDescription: '配置 Provider 端点、限制和只写 Binance 凭据。',
  financeSecurityNote: 'API Key 和 Secret 由凭据服务保存，不写入设置文件。模型只能请求 signed，永远不会收到凭据。',
  financeProvider: 'Provider',
  financeProviderHint: 'fixture 使用确定性本地数据；http 使用配置的公共端点。',
  financeProviderFixture: 'fixture',
  financeProviderHttp: 'http',
  financeTimeoutMs: '请求超时（毫秒）',
  financeTimeoutMsHint: '实时 Provider 调用的单次请求超时。',
  financeBarLimit: '历史 K 线上限',
  financeBarLimitHint: '标准化快照加载请求的最大 K 线数量。',
  financeYahooBaseUrl: 'Yahoo Finance Base URL',
  financeBinanceSpotBaseUrl: 'Binance Spot Base URL',
  financeBinanceUsdmBaseUrl: 'Binance USD-M Base URL',
  financeBinanceCoinmBaseUrl: 'Binance COIN-M Base URL',
  financeBinanceOptionsBaseUrl: 'Binance Options Base URL',
  financePolymarketGammaBaseUrl: 'Polymarket Gamma Base URL',
  financePolymarketClobBaseUrl: 'Polymarket CLOB Base URL',
  financeEndpointHint: '留空则使用部署默认值。',
  financeEnableSignedRequests: '允许 Binance signed 请求',
  financeEnableSignedRequestsHint: '启用后，显式标记为 signed 的请求会在 Host 使用已存 Binance 凭据认证。',
  financeCoinMarketCapTitle: 'CoinMarketCap',
  financeEnableCoinMarketCapRequests: '允许 CoinMarketCap API 请求',
  financeEnableCoinMarketCapRequestsHint: '启用后，Host 侧 CoinMarketCap REST 和 WebSocket 请求会使用已存 API Key。',
  financeCoinMarketCapBaseUrl: 'CoinMarketCap Pro REST Base URL',
  financeCoinMarketCapWebSocketBaseUrl: 'CoinMarketCap WebSocket URL',
  financeCoinMarketCapApiKey: 'CoinMarketCap API Key',
  financeCoinGeckoTitle: 'CoinGecko 社区数据',
  financeEnableCoinGeckoRequests: '读取 CoinGecko 社区与开发数据',
  financeEnableCoinGeckoRequestsHint: '需要 CoinGecko 免费 demo API Key。仅对加密标的引用社区与开发数据。',
  financeCoinGeckoBaseUrl: 'CoinGecko API 地址',
  financeCoinGeckoApiKey: 'CoinGecko demo API Key',
  financeCoinGeckoApiKeyHint: '在 coingecko.com/zh/developers/dashboard 免费申请。与其他金融凭据一样加密存储。',
  financeGithubToken: 'GitHub Token（可选）',
  financeGithubTokenHint: '可选。公开仓库无需 token 即可读取；配置 token 只是把共享的每小时 60 次限额提高。',
  financeAlphaVantageTitle: 'Alpha Vantage 美股基本面',
  financeEnableAlphaVantageRequests: '读取 Alpha Vantage 美股基本面',
  financeEnableAlphaVantageRequestsHint: '为美股报告补上市盈率、市净率、利润率、增长、板块与行业。需要 Alpha Vantage 免费 Key。',
  financeAlphaVantageBaseUrl: 'Alpha Vantage API 地址',
  financeAlphaVantageApiKey: 'Alpha Vantage API Key',
  financeAlphaVantageApiKeyHint: '在 alphavantage.co/support/#api-key 免费申请。免费档每天 25 次请求。',

  financeFredTitle: '宏观数据（FRED）',
  financeEnableFredRequests: '允许 FRED 宏观请求',
  financeEnableFredRequestsHint: 'FRED 提供美国宏观长序列：利率、信用利差、PCE、非农与美元指数。需要免费的 FRED API Key。',
  financeFredBaseUrl: 'FRED API 地址',
  financeFredApiKey: 'FRED API Key',
  financeFredApiKeyHint: '仅保存在 Host，不会回传给模型。',
  financeFredApiKeyLink: '申请免费的 FRED API Key',
  financeCoinMarketCapApiKeyHint: '只写。保存在设置文件之外；留空表示保持当前 Key。',
  financeStockTitle: 'A 股数据桥',
  financeEnableAkshare: '启用 AKShare 股票数据',
  financeEnableAkshareHint: '需要在配置的 Python 解释器中安装 akshare。',
  financeEnableIfind: '启用同花顺 iFinD 股票数据',
  financeEnableIfindHint: '需要已授权的 iFinD 账号；HTTP API 使用 refresh token，本地 SDK 需要厂商 SDK。',
  financeIfindTransport: 'iFinD 接入方式',
  financeIfindTransportHint: 'http 使用同花顺 HTTP API；local 使用厂商 iFinDPy SDK。',
  financeIfindTransportHttp: 'HTTP API',
  financeIfindTransportLocal: '本地 SDK',
  financeIfindBaseUrl: 'iFinD HTTP API Base URL',
  financeIfindBaseUrlHint: '同花顺 iFinD HTTP API 的 Base origin。',
  financePythonExecutable: 'Python 可执行文件',
  financePythonExecutableHint: '运行内置股票桥的 Python 解释器。',
  financeStockBridgeTimeoutMs: '股票桥超时（毫秒）',
  financeStockBridgeTimeoutMsHint: '单次 AKShare 或 iFinD 请求的最长时间。',
  financeStockBridgeMaxOutputBytes: '股票桥输出上限（字节）',
  financeStockBridgeMaxOutputBytesHint: '每个输出流最多捕获多少字节。',
  financeIfindUser: 'iFinD 账号',
  financeIfindUserHint: '只写。保存在设置文件之外；留空表示保持当前账号。',
  financeIfindPassword: 'iFinD 密码',
  financeIfindPasswordHint: '只写。保存在设置文件之外；留空表示保持当前密码。',
  financeIfindRefreshToken: 'iFinD refresh token',
  financeIfindRefreshTokenHint: '只写。HTTP API 接入使用；留空表示保持当前 token。',
  financeBinanceApiKey: 'Binance API Key',
  financeBinanceApiKeyHint: '只写。保存在设置文件之外；留空表示保持当前 Key。',
  financeBinanceApiSecret: 'Binance API Secret',
  financeBinanceApiSecretHint: '只写。保存在设置文件之外；留空表示保持当前 Secret。',
  financeCredentialSet: '已配置',
  financeCredentialUnset: '未配置',
  financeDeliveryTitle: '实时与监控',
  financeBinanceWebSocketBaseUrl: 'Binance WebSocket Base URL',
  financeMarketStreamTimeoutMs: '实时流超时（毫秒）',
  financeMarketStreamTimeoutMsHint: '一次实时事件采集的最长等待时间。',
  financeMarketStreamMaxEvents: '单次最大事件数',
  financeMarketStreamMaxEventsHint: '一次实时事件采集最多返回多少条消息。',
  financeTransportTitle: '缓存、限流与重试',
  financeRequestCacheTtlMs: '缓存有效期（毫秒）',
  financeRequestCacheTtlMsHint: '公开 GET 响应的缓存时间；signed 请求不缓存。',
  financeRequestCacheMaxEntries: '缓存条目上限',
  financeRequestCacheMaxEntriesHint: '内存中最多保留多少个公开 GET 响应。',
  financeRequestMaxRetries: '最大重试次数',
  financeRequestMaxRetriesHint: '初次请求失败后最多重试多少次。',
  financeRequestRetryBaseDelayMs: '首次重试延迟（毫秒）',
  financeRequestRetryBaseDelayMsHint: '指数退避的初始延迟。',
  financeRequestRetryMaxDelayMs: '最大重试延迟（毫秒）',
  financeRequestRetryMaxDelayMsHint: '指数退避允许的最大延迟。',
  financeRequestsPerMinute: '每分钟请求上限',
  financeRequestsPerMinuteHint: '每个上游 origin 共享的令牌桶补充速率。',
  financeRequestBurst: '突发请求上限',
  financeRequestBurstHint: '令牌桶可积累的最大突发容量。',
}
