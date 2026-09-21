---
description: "使用和维护实验性 Web 金融仪表盘，通过 Host 行情路由查看加密货币、A 股和美股图表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-finance-dashboard

[English](README.md) | 中文

## 概述

这个浏览器插件为 Web Client 增加一个 **金融仪表盘** 全局面板。面板读取已提供的 `finance-research` 设置命名空间，并轮询认证 `/api` 通道上的 Host 行情路由，使 Provider 调用、凭据和跨域策略都留在 Host。面板通过 `lightweight-charts` 渲染加密货币、A 股和美股 K 线，并支持可配置的指标集——均线、带状指标、SAR、VWAP、神奇九转、成交量和各类震荡指标——Canvas 不可用时回退为内联 SVG 折线。本包不注册模型可见输入，也不会收到 Provider 凭据；私有账户数据仍只通过 Host 侧 `finance_private_account` 工具提供。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

先安装 Host 侧金融 Profile，再把这个包加入 Web Profile：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-finance-research-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-client-ui-finance-dashboard
```

仓库示例还提供 [`dashboard.patch.yml`](../../../apps/cli/config/examples/finance-research/dashboard.patch.yml)。只有 `finance-research` 设置命名空间被提供时，侧边栏入口才会出现，因此未安装 Host 金融插件的部署不会显示无效面板。

### 配置数据源

仪表盘跟随已提供的 `finance-research` 设置命名空间：命名空间变化会重新加载当前选择，A 股标签页只有在 Host 已启用所选 Provider 时才能成功。面板还会把浏览器当前语言写入该命名空间，使 Host 侧生成的金融报告跟随用户看到的语言。Provider 端点、凭据和开关都留在金融设置中，不会到达浏览器；面板自身不拥有设置命名空间。

### 阅读面板

顶部可选择资产类别、标的和周期，并提供显式刷新。标签页覆盖加密货币、A 股和美股，每个都带快捷标的列表。指标区显示最新价、相对上一根 K 线的涨跌幅和最新成交量。图表通过 `lightweight-charts` 渲染所选指标，Canvas 不可用时改用内联 SVG 折线。指标设置模块按主图叠加与独立副图分组，可勾选指标、编辑各自周期参数，并重置单个指标或全部指标为默认值；选择与参数持久化在浏览器存储的 `dsh.finance.dashboard.indicators.v1` 下。神奇九转会在 K 线上标注买卖计数，并按配置的目标计数高亮。每个副图都标注自己绘制的指标，主图则在原位列出叠加指标。没有历史数据的标的显示带刷新按钮的空状态页面，而不是数据源的报错文本；原始报错收在该页面的技术详情折叠项里。请求徽标显示连接中、实时或错误状态；控制器每 15 秒重新轮询，面板释放时停止轮询，并丢弃切换选择后才返回的响应。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

本包通过 Cordis effect 注册一个 `main` keyed 面板和一个匹配的 `sidebar.panellist` 入口。`FinanceDashboardController` 拥有一个快照 store、一个 Host 请求路径和一个轮询定时器。Host 响应在浏览器边界防御性解析；格式错误的 K 线会被丢弃。行情路由的 Host 侧位于金融研究包，并注册到 Connection 的认证精确路由注册表。

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 金融命名空间门控、面板注册和 locale 注册 |
| [`src/client/controller.ts`](src/client/controller.ts) | Host 行情轮询、刷新生命周期和仪表盘状态 |
| [`src/client/market-data.ts`](src/client/market-data.ts) | Host 响应解析、指标序列和 SVG 图表几何 |
| [`src/client/indicators.ts`](src/client/indicators.ts) | 可选指标目录、参数范围与图表高度 |
| [`src/client/indicator-store.ts`](src/client/indicator-store.ts) | 持久化的指标选择、参数覆盖与重置 |
| [`src/client/IndicatorSettings.tsx`](src/client/IndicatorSettings.tsx) | 指标设置弹窗：分组、参数与重置 |
| [`src/client/TradingChart.tsx`](src/client/TradingChart.tsx) | `lightweight-charts` 渲染与 SVG 回退 |
| [`src/client/FinanceDashboard.tsx`](src/client/FinanceDashboard.tsx) | 仪表盘控件、指标、图表和状态展示 |
| [`src/client/locales.ts`](src/client/locales.ts) | 中英文面板文案 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Finance research tools](../finance-research/README.zh.md) — Host 侧私有账户、Provider 请求、实时流采集和监控规划工具。
- [Finance research example](../../../apps/cli/config/examples/finance-research/README.zh.md) — Team-aware preset 安装和仪表盘 overlay。
- [Web layout](../../client/ui-layout/README.zh.md) — 全局 `main` 面板和 `sidebar.panellist` 契约。
- [Experimental packages](../README.zh.md) — 实验状态和发布策略。

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser panel registers no model-facing schema or prompt content.

#### KV Cache effect

No direct effect; the Host-side finance tools own any later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **轮询而非流式** — 面板重新轮询 Host 路由，而不是跟随实时流，因此行情最多滞后一个轮询周期。
- **行情数据依赖 Provider** — 加密货币、A 股和美股历史来自 Host 上配置的 Provider；不展示私有余额、持仓或期货数据。
- **单交易对** — 图表不支持多交易对叠加、订单簿深度或图表批注持久化。
- **无交易控制** — 面板不能下单、撤单或改单。
- **无离线历史** — 刷新页面会丢弃内存中的 K 线窗口并重新获取快照。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The panel owns one visible controller and disposes its polling timer and registrations with the plugin fiber.
