/** Finance dashboard dictionary. */

export const NS = 'financeDashboard'

/** English finance dashboard copy. */
export const en = {
  title: 'Finance dashboard',
  subtitle: 'Live Binance market data and stream health.',
  symbol: 'Symbol',
  interval: 'Interval',
  refresh: 'Refresh',
  loading: 'Loading market data…',
  live: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline',
  error: 'Market data unavailable',
  empty: 'No market data',
  close: 'Close',
  change: 'Change',
  volume: 'Volume',
  accountNote: 'Private account data stays in the Host and is available through finance_private_account.',
  chartLabel: 'Price chart',
} as const

/** Locale keys owned by the finance dashboard. */
export type FinanceDashboardLocaleKey = keyof typeof en

/** Chinese finance dashboard copy. */
export const zh: Record<FinanceDashboardLocaleKey, string> = {
  title: '金融仪表盘',
  subtitle: 'Binance 实时行情与连接状态。',
  symbol: '交易对',
  interval: '周期',
  refresh: '刷新',
  loading: '正在加载行情…',
  live: '实时',
  connecting: '连接中…',
  offline: '离线',
  error: '行情不可用',
  empty: '暂无行情',
  close: '最新价',
  change: '涨跌幅',
  volume: '成交量',
  accountNote: '私有账户数据只保留在 Host，可通过 finance_private_account 查询。',
  chartLabel: '价格图',
}
