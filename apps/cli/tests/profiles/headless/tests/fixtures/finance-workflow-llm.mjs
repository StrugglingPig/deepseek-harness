/** Deterministic keyless finance Workflow adapter for the finance-only profile e2e. */

import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'

let nextCall = 0

function calls(messages) {
  return messages.flatMap(message => message.role === 'assistant'
    ? message.content.filter(block => block.type === 'tool-call').map(block => block.name)
    : [])
}

function toolChunks(specs) {
  const chunks = []
  for (const [index, spec] of specs.entries()) {
    const id = ToolCallId(`finance-workflow-fixture-${++nextCall}`)
    const args = JSON.stringify(spec.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: spec.name, argumentsDelta: args },
      { type: 'block-end', index, block: { type: 'tool-call', id, name: spec.name, arguments: args } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function rootChunks(messages) {
  const names = calls(messages)
  if (!names.includes('finance_provider_describe')) {
    return toolChunks([{ name: 'finance_provider_describe', args: {} }])
  }
  if (!names.includes('workflow')) {
    return toolChunks([{
      name: 'workflow',
      args: {
        meta: {
          name: 'finance-provider-preflight',
          description: 'Verify finance provider discovery in a keyless workflow child.',
        },
        script: 'const child = await agent("FINANCE_WORKFLOW_CHILD"); return { child };',
      },
    }])
  }
  return textChunks('FINANCE_WORKFLOW_OK: finance provider discovery completed in a workflow child.')
}

function childChunks(messages) {
  const names = calls(messages)
  if (!names.includes('finance_provider_describe')) {
    return toolChunks([{ name: 'finance_provider_describe', args: {} }])
  }
  return textChunks('FINANCE_WORKFLOW_CHILD_OK')
}

class FinanceWorkflowFixtureAdapter extends LlmAdapter {
  async * stream(options) {
    const tools = options.tools.map(tool => tool.name)
    if (!tools.includes('finance_provider_describe')) {
      throw new Error('Finance workflow profile is missing finance provider discovery')
    }
    const initial = options.messages.findLast(message => message.role === 'user' && message.source.kind === 'user')
    const identity = initial?.content[0]?.text?.trimEnd()
    const chunks = identity === 'FINANCE_WORKFLOW_CHILD'
      ? childChunks(options.messages)
      : rootChunks(options.messages)
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name. */
export const name = 'finance-workflow-fixture-llm'
/** LLM registry dependency. */
export const inject = ['llm']

/** Register the keyless adapter on the shipped default provider route. */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official'], new FinanceWorkflowFixtureAdapter())
}
