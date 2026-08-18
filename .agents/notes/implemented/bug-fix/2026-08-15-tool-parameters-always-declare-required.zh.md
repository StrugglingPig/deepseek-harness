# Agent Note: 工具参数 schema 始终声明 `required` 数组

Status: implemented

中文 | [English](2026-08-15-tool-parameters-always-declare-required.md)

## Problem

零参数工具在每一次真实 DeepSeek 请求中都失败，报错 `INVALID_REQUEST: Invalid schema for function '<name>': null is not of type "array"`。受影响的工具——`get_goal`、`job_list`、`list_agents`、`terminal_list`、`schedule_list`、`cordis_inspect_list`、`cordis_inspect_self` 与 `session_trace`——都声明 `parameters: {}`，schema 编译器将其投影为 `{"type":"object","properties":{}}`，完全省略了 `required`。DeepSeek 的 chat-completions 网关按元 schema 校验每个 function 的 `parameters`，其中 `required` 字段是必填的；缺失的字段被当作 `null`，从而无法通过数组类型检查。

缺失源自 `parameterSchemaSpecToJsonSchema`：仅当至少一个参数携带 `required: true` 时才输出 `required`。编译后的属性映射在内部保持 `required` 可选（`CompiledPropertyMap.required?: string[]`），这种可选性在线上泄漏为"无必填参数的工具恰好缺失该数组"。回放快照没有发现它，因为快照只记录组装的 schema，不经过真实网关；能发现它的 e2e 层在没有 key 时自跳过。

## Decision

`parameterSchemaSpecToJsonSchema` 始终输出 `required`，没有必填参数时默认为 `[]`。投影结果现在是：

```json
{ "type": "object", "properties": {}, "required": [] }
```

内部 `CompiledPropertyMap` 保持不变：它还服务于显式 object *value* schema，那里的 `required` 保持"为空即省略"（输出 schema 不会进入 function `parameters` 的线上位置，所以修复应落在参数投影处，而非共享编译器）。

## Alternatives considered

- **只修补 DeepSeek 适配器的 `serializeRequest`。** 在传入的 `parameters` 缺少 `required` 时补上 `[]`。这把特例限制在唯一会拒绝它的提供商内，但把线上格式事实藏进一个适配器，且让 schema 层继续产出需要全世界来归一化的 schema。拒绝理由：参数投影是每个工具 function schema 诞生的唯一位置，因此"function schema 始终带有 `required`"这一不变量应当落在那里。
- **给每个零参数工具加一个占位属性。** 把每个 `parameters: {}` 变成一个模型必须忽略的合成字段，污染模型契约和所有 catalog／快照，却没有任何 schema 收益。
- **保持省略并特判网关。** 不存在受支持的钩子去放宽网关的元 schema；且空 `required` 在 JSON Schema 中与省略语义相同，所以输出它的代价为零。

## Consequences

每个零参数工具现在在线上发送 `required: []`，工具 catalog 也渲染它。原本就声明了 `required` 的工具不受影响。模型看到显式的空必填列表而非缺失字段；这只是注解层面的变化，不改变工具接受的参数。`ParameterJsonSchema` 类型本来就允许 `required?: string[]`，没有放宽任何公开类型。

## Testing

`schema.spec.ts` 固定了空投影不变量（`parameterSchemaSpecToJsonSchema({})` → `required: []`），tools 包中断言旧"无 required"输出的测试已同步更新。ACP `tool-schemas` 快照与两份工具 catalog 已重新生成。一次真实的 `dsh --profile headless` 运行确认线上 API 接受了修正后的 schema。
