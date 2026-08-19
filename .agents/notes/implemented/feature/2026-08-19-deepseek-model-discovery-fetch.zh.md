# Agent Note:DeepSeek 模型发现获取

Status: implemented

[English](2026-08-19-deepseek-model-discovery-fetch.md) | 中文

## 问题

模型设置页的"获取可用模型"只提供给 pi-ai 配置。DeepSeek 卡片的自定义设置折叠区只能手工编辑其建议目录:把 `llm-deepseek.baseURL` 指向网关或代理的部署必须手工抄录该端点的模型列表,而一步之遥的 pi-ai 卡片却能通过 OpenAI 的 `GET /models` 形态列出端点模型。两个根因:`llm-deepseek` 从未注册 `ctx.llm.registerModelDiscovery`;客户端则用 pi-ai 编辑器的手工孪生组件渲染 DeepSeek 家族。

## 决定

**在 `@deepseek-ai/dsh-llm` 中共享一份网络查询。** OpenAI 兼容的 `GET /models` 读取器(前缀拼接 listing 路径、bearer 认证、归属头、4MiB 实收字节上限、跳过无可用 id 的条目、`DISCOVERY_FAILED`/`INVALID_CREDENTIAL`/`ABORTED` 分类)从 `llm-pi-ai/src/discovery.ts` 移入 dsh-llm,成为 `fetchOpenAiCompatibleModels`。在 `llm-deepseek` 里复制第二份会触发仓库 jscpd 门禁(minTokens 60 / minLines 6)且必然漂移;pi-ai 只保留属于它自己的部分:已安装目录短路与 `LISTABLE_PROTOCOLS` 门。

**`llm-deepseek` 以两条路径注册发现。** 指明自有路由且不带 baseURL 的探针从活建议目录(`options().models`)应答,每次询问都读取,配置编辑无需重新注册即生效,且零网络调用。携带 baseURL 的探针——包括针对自有路由的,因为那正是要测试的网关——通过共享读取器询问端点。存储密钥解析器是软式的:没有密钥的区段以未认证方式探针,而不是抛请求路径的 `MISSING_CREDENTIAL`,与 pi-ai 的姿态一致;适配器的请求路径仍从同一解析器抛错,一份实现服务两种语义,文件里不留近似重复对以免 duplication 门禁标记。

**客户端统一到 `ModelListEditor`。** 删除 `DeepSeekModelsEditor`;其纯辅助(草稿形态、K/M 容量词汇、适配器目录校验)移入 `model-drafts.ts`。统一编辑器移植 deepseek 测试钉死的行为——失焦裁剪 id、失焦 settle 容量、reset 清空行级缓冲——并接受可选 `defaultContextWindow`/`defaultMaxTokens`,使 DeepSeek 卡片用适配器回退值作容量占位符,pi-ai 保留通用量级。本地化占位符键随最后读者一并删除。

**被采纳的行继承适配器已知事实。** 朴素的 `GET /models` 回复通常只公布 id,导致被采纳的行读起来比内置行贫乏(显示名称空、容量空)。deepseek 发现按 id 回填网络回复(`dsh-llm` 中共享且 jscpd 安全的 `enrichDiscoveredModels`),端点已提供的信息保持权威;客户端另将被采纳行的显示名称默认为其 id。知识源是活目录与按 id 事实表的合并:内置的市面常用模型默认表(数字镜像 pi-ai twin 随附的厂商 catalog 数据)被 `modelFacts` 设置项按 id 覆盖,代理改名的模型仍能自动填充;内置建议目录现在也携带每个 V4 路由的输出上限。pi-ai 无需回填:其 catalog 路由从不走网络,而非 catalog 路由没有可继承的已知事实。

## 备选方案

**在 `llm-deepseek` 内复制网络读取器。** 否决:duplication 门禁正为此而设,且两份读取器会在数周内就网关扩展字段(`display_name`/`context_length` 拼写)漂移。

**保留两个编辑器、给手工孪生加获取按钮。** 否决:两个编辑器本就只差额外项;获取动作、候选弹窗与采纳合并会成为第二份复制,且行行为(失焦 settle、reset 语义)已经漂移过一次。

**对自有路由的 baseURL 探针从目录应答。** 否决:用户填的 baseURL 正是被测端点;若描述内置端点,将列出错误服务器的模型。

## 后果

DeepSeek 卡片现在提供标准协议获取:成功打开采纳弹窗(已配置的 id 默认不勾选),失败在仍可手工编辑的行旁显示适配器消息。免 key e2e 通过 `models-settings.e2e.ts`(`deepseek-edit.expected.md`)覆盖按钮与弹窗,因为指名路由的探针从目录应答,无需网络与凭证。`dsh-llm` 公共面新增一个辅助;其 README、两个适配器 README 与 `ui-settings-models` README 均命名该共享读取器。验证:三个 llm 包与客户端包的聚焦 vitest、逐文件覆盖门禁、jscpd、web 快照回放。
