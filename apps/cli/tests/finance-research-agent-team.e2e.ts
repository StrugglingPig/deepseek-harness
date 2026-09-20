import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const fixturePlugin = pathToFileURL(fileURLToPath(
  new URL('./profiles/headless/tests/fixtures/team-llm.mjs', import.meta.url),
)).href

function records(content: string): Record<string, unknown>[] {
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('finance research with Agent Teams', () => {
  it('exposes finance provider discovery to every Team role and completes dependent tasks', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-finance-agent-team-'))
    try {
      const home = join(cwd, '.dsh')
      const sessions = join(home, 'sessions')
      const profileDir = join(home, 'profiles', 'headless')
      await mkdir(profileDir, { recursive: true })
      await writeFile(join(profileDir, 'package.json'), JSON.stringify({
        name: 'dsh-profile-finance-team',
        private: true,
        dependencies: {
          '@deepseek-ai/dsh-experimental-agent-team-profile': 'workspace:^',
          '@deepseek-ai/dsh-experimental-finance-research-profile': 'workspace:^',
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-headless',
              '@deepseek-ai/dsh-experimental-agent-team-profile',
              '@deepseek-ai/dsh-experimental-finance-research-profile',
            ],
          },
        },
      }, undefined, 2) + '\n')
      await writeFile(join(profileDir, 'cordis.patch.yml'), [
        '- id: llm-deepseek',
        '  disabled: true',
        '- id: session-persistence-jsonl',
        '  config:',
        `    root: '${sessions}'`,
        '    compression: none',
        '- id: finance-research',
        '  config:',
        '    provider: http',
        '- insert:',
        '    - id: team-fixture-llm',
        `      name: '${fixturePlugin}'`,
        '',
      ].join('\n'))
      const launch = resolveExampleLaunch({
        srcBin: dshBinScript,
        mode: 'lib',
        configArgs: ['--profile', 'headless', 'SKIP_WORKFLOW 先确认金融 Provider，再使用 Agent Teams 拆分两个依赖任务，等待完成后汇总。'],
        tsconfigPath,
        env: {
          DSH_HOME: home,
          DSH_AGENTS_HOME: join(cwd, '.agents'),
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: '',
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            '--disable-warning=ExperimentalWarning',
            '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
          ].filter(Boolean).join(' '),
        },
      })
      const result = await execa(launch.command, launch.args, {
        cwd,
        env: launch.env,
        input: '',
        timeout: 120_000,
        killSignal: 'SIGKILL',
        reject: false,
      })
      expect(
        result.exitCode,
        `finance Agent Teams run exited unexpectedly.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('FINANCE_TEAM_OK')

      const files = (await readdir(sessions, { recursive: true }))
        .filter(file => file.endsWith('.jsonl'))
      expect(files).toHaveLength(3)
      const parsed = await Promise.all(files.map(async file => records(await readFile(join(sessions, file), 'utf8'))))
      for (const log of parsed) {
        expect(log.some(record => record.type === 'tool/call'
          && (record.data as { name?: string }).name === 'finance_provider_describe')).toBe(true)
      }

      const root = parsed.find((log) => {
        const header = log[0]
        return header?.type === 'session' && typeof header.parentSession !== 'string'
      })
      expect(root).toBeDefined()
      const rootToolNames = root!.filter(record => record.type === 'tool/call')
        .map(record => (record.data as { name?: string }).name)
      expect(rootToolNames).toContain('finance_provider_describe')
      expect(rootToolNames).toContain('spawn_teammate')
      expect(rootToolNames).toContain('wait_agent')
      expect(rootToolNames).toContain('team_task_list')
      expect(rootToolNames).toContain('list_agents')
      expect(rootToolNames).not.toContain('subagent')
      expect(rootToolNames).not.toContain('subagent_fork')

      const eventTypes = root!.map(record => record.type)
      expect(eventTypes.filter(type => type === 'team/member')).toHaveLength(4)
      expect(eventTypes).toContain('team/message/queued')
      expect(eventTypes).toContain('team/message/delivered')
      expect(root!.filter(record => record.type === 'team/task').filter((record) => {
        const data = record.data as { task?: { status?: string } } | undefined
        return data?.task?.status === 'completed'
      })).toHaveLength(2)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 135_000)
})
