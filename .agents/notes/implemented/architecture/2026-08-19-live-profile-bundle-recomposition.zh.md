# Agent Note：插件安装无需重启即可活重组运行中的 profile bundle 层

Status: implemented

[English](2026-08-19-live-profile-bundle-recomposition.md) | 中文

## 问题

Profile 的 bundle 层过去在启动时冻结：`loadProfile` 只解析一次 `dsh.profile.bundles`，因此安装或移除 bundle（`dsh plugin add/remove`、dshmarket、plugin-manager 界面或手工编辑 manifest）都需要重启进程才能改变宿主面。dshmarket 的 hotMount 仅对纯 insert 补丁做了缓解：它把副本挂载在 market 自己的 Include 子树下，无法表达其他补丁形态（其判定回退为「重启」），而且持久安装落地后热挂载副本仍在运行，同一个包的宿主 fiber 会跑两份。浏览器侧，client-hmr 忽略 `graph` 帧：新的 client 行进入供图后不可见，需要手动刷新页面。

## 决定

在 manifest 接缝处实现 bundle 层活重组，并配套双挂载守卫与浏览器 entry 集合传播：

- **层重解析**（`@deepseek-ai/dsh-app-boot`）：从 `loadProfile` 抽出 `resolveBundleLayers`，`reloadProfileLayers` 每代重新执行它——修复共享模块回退目录、重读 manifest、重新解析各层。它不读取用户补丁层（由调用方的 `compose` 闭包按代负责），也从不改写 `cordis.yml`（运行中改写会触发一次冗余的根 include 刷新）。
- **manifest 监听**：`watchProfileManifest` 把 profile 的 `package.json` 注册在与 `watchUserPatches` 相同的 Cordis HMR 配置监听接缝上。被监听的文件不按补丁列表解析——它是包管理器改写的 JSON manifest；每次变更调用调用方的 `compose()`，并通过 `entry.update` 以事务方式重新应用完整补丁栈。有界重试（`attempts` × `delayMs`）自愈撕裂代——manifest 先于包管理器把所列包物化落盘——无需第二次文件事件；重试耗尽则回退到 HMR 服务高声的 `hmr/config-update-failed` 广播，上一棵良好的树继续运行。原生事件投递也可能在包管理器大量 churn 下整体丢弃一次改写（FSEvents 队列压力），因此 stat 兜底（`pollMs`，默认 2s）核对 manifest mtime 并重新触发同一条串行化世代路径——事件仍是低延迟路径，轮询是可靠性底线。在某代运行中落下的请求（事件或轮询）会被合并为一次排队的重跑：运行中的那代可能在写入落盘前就读了 manifest，丢弃请求会让该写入永久丢失（2026-08-20 的审查正好抓到此竞态，已有回归测试门禁）。
- **启动器每代重推导一切**（`apps/cli` 的 `composeLive`）：bundle 层经 `reloadProfileLayers`，两个用户补丁文件重新读取，派生 overlay（agent-presets 出厂根目录与遥测开关）按该代自身的行索引重算，使 bundle 增删能带动其依赖的行。argv overlay 保持冻结（argv 不可变），每代对补丁做克隆，防止 include 按引用插入的别名效应把覆盖烘焙进后续各代。
- **双挂载守卫**：loader 条目 id 的唯一性是 per-tree 的，因此 market 热行（market 自身子树下的 `mkt-` id）与重组后的持久行永不冲突——但包的宿主 fiber 会跑两份。`duplicateSubtreeEntry` 是纯判定：持久层恰好是根 include 自身子树的顶层（每份组合出的补丁都插入那里），仅当一个已创建 fiber 的条目不在该顶层、且其 `options.name`（包名）与某个存活且启用的持久行重复时才标记。成员判定读取顶层 store，而非按森林递归——递归会错误地庇护热挂载自己的嵌套行。`installBundleLayerGuard` 在此类行出现时移除它（覆盖重组先落地的顺序）；`disposeDuplicateSubtreeEntries` 在每次成功重组后作为 `afterUpdate` 钩子扫描本 loader 的森林（覆盖该处热挂载先落地的顺序；另一个 loader realm 中的热行只能通过创建事件触达）。无 entry 的 fiber（preset 子树、直接挂载的插件）以及没有同名存活持久行的条目（纯 client 垫片）永不被标记；移除失败只记警告，不外逃。
- **安装侧权威解析**：同一类可能把活重组悬空的缺陷——profile 侧被 hoist 的 in-box 包副本遮蔽安装侧自有构建、随后又被卸载剪枝——在每一个裸名解析位点关闭：根 include 的导入（`builtins.include` 携带该类，因此所有嵌套 include 树继承同一顺序）、client 表与 agent-preset 子树。启动器提供 `dshInstallAnchors`——app 的 package.json 加每个组合包的，按序尝试，因为单一 package.json 不声明整个 in-box 闭包（2026-08-20 的事故证明单锚点形态对锚点不携带的名称会静默落到配置目录查找，加载 hoist 的旧副本并分裂模块身份：会话创建随之全进程失败）。in-box 包从运行中的安装解析，profile 目录只保留树外插件。旧安装残留的 hoist 副本变为惰性——解析绕过它们，无需任何清理。
- **浏览器 entry 集合**（`@deepseek-ai/dsh-client-hmr`）：node 侧在 `/plugins/events` effect 内订阅 `clientModules.onGraphChanged`，每次变更向所有连接写入新的 `graph` 帧；纯内容重建仍走 `rebuilt` 帧。浏览器侧把每帧的 id 集合与页面启动 manifest（`window.__DSH_BOOT__`）比较：集合相同则取消待定 reload；集合不同则在 750ms 防抖后调度 `location.reload()`，触发时再核一次，若后续帧恢复了启动集合则取消。没有启动 manifest 的页面永不因帧 reload。

## 考虑过的替代方案

- **维持重启要求**：否决——安装后即时可见正是本功能；hotMount 路径已证明需求存在，但它只覆盖纯 insert 且会双挂载。
- **把 dshmarket 的 hotMount 扩展为通用机制**：否决——hotMount 是只能表达纯 insert 的写入方 UI 代码；manifest 接缝覆盖所有写入方（CLI、market、plugin-manager、手工编辑）与完整补丁词汇，并让卸载成为事务性 dispose，而非手工卸载。
- **免 reload 的浏览器增量挂载/卸载**：延后。启动内核在屏障后按整份 manifest 创建条目并清扫至 ACTIVE；增量接入需要模块系统与内核的支持，`graph` 帧协议后续可以承载。一次自动 reload 严格优于它所替代的手动刷新。
- **监听 profile 的 `node_modules` 而非 manifest**：否决——manifest 是各写入方共同认可的提交点（CLI 只在包管理器完成后才写 bundle 列表）；`node_modules` 的变动嘈杂且处于安装中间态。manifest 顺序可能产生的撕裂代，正是有界重试要自愈的对象。

## 后果

- 任何 manifest 写入方都获得宿主面即时激活与事务性卸载，无需重启。市场对复杂补丁的「重启」判定从此偏保守：宿主可能已经活落地（已记录的判定错配，严格优于承诺）。
- 热挂载与持久层按规则共存——后落地者让位。移除按行进行且有 containment，一个损坏的热行不会拖垮它跟随的那次重组。
- 浏览器在每次 entry 集合变化时 reload 一次；页内插件状态丢失，与它所替代的手动刷新完全一致，而内容重建保留原位热替换。
- **插件更新（版本升级）仍需重启**：Node 的 ESM import 缓存会对同一解析 URL 返回已导入的模块，重组后的行会挂载过时代码。安装/卸载按设计是活路径；更新保持重启要求。
- 重试有界且高声：耗尽重试预算后仍失败的一代经 `hmr/config-update-failed` 暴露，上一棵良好的树继续服务。
