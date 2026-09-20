---
description: "使用和维护实验性 Web 金融仪表盘，查看 Binance Spot 实时图表和连接状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-finance-dashboard

[English](README.md) | 中文

## 概述

这个浏览器插件为 Web Client 增加一个 **金融仪表盘** 全局面板。面板读取已提供的 `finance-research` 设置命名空间，通过 REST 加载 Binance Spot K 线，跟随所选交易对和周期的 Binance 组合 WebSocket 流，并渲染行情指标与轻量 SVG 价格图。本包不注册模型可见输入，也不会收到 Binance 凭据；私有账户数据仍只通过 Host 侧 `finance_private_account` 工具提供。

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

### 配置端点

仪表盘从金融设置读取 `binanceBaseUrl` 和 `binanceWebSocketBaseUrl`。设置改变会关闭当前流；再次打开面板时会使用新端点重新加载历史。面板自身不拥有设置命名空间。

### 阅读面板

顶部可选择交易对和周期，并提供显式刷新。指标区显示最新收盘价、相对首个已加载 K 线的涨跌幅和最新成交量。图表是收盘价的内联 SVG 折线。连接徽标显示连接中、实时、离线或错误状态。控制器会在意外断开后重连；重连间隔配置为零或面板释放时停止重连。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

本包通过 Cordis effect 注册一个 `main` keyed 面板和一个匹配的 `sidebar.panellist` 入口。`FinanceDashboardController` 拥有一个快照 store、一个 REST 请求路径、一个 WebSocket 和一个重连定时器。REST 响应在浏览器边界防御性解析；格式错误的 K 线行会被丢弃。WebSocket 更新在时间戳相同时替换当前 K 线，否则追加。

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 金融命名空间门控、面板注册和 locale 注册 |
| [`src/client/controller.ts`](src/client/controller.ts) | REST 历史、实时流、重连和仪表盘状态 |
| [`src/client/market-data.ts`](src/client/market-data.ts) | Binance 交易对标准化、K 线解析和 SVG 几何 |
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

- **仅公共 Spot 数据** — 面板读取公共 Binance Spot K 线和组合流；不展示私有余额、持仓或期货数据。
- **单交易对** — 图表不支持多交易对叠加、订单簿深度或图表批注持久化。
- **无交易控制** — 面板不能下单、撤单或改单。
- **无离线历史** — 刷新页面会丢弃内存中的 K 线窗口并重新获取快照。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The panel owns one visible controller and disposes its stream and registrations with the plugin fiber.
