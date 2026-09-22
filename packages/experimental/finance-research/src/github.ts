/** GitHub REST response normalization. */

import type { FinanceGithubRepo } from './types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finite(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

/**
 * Normalize a GitHub repository response.
 * @param payload - Upstream `/repos/{owner}/{name}` JSON.
 * @param repository - Repository the response was requested for.
 * @returns The snapshot, or undefined when the payload carries no repository name.
 */
export function normalizeGithubRepo(payload: unknown, repository: string): FinanceGithubRepo | undefined {
  const repo = record(payload)
  if (repo === undefined || typeof repo.name !== 'string') return undefined
  const stars = finite(repo.stargazers_count)
  const forks = finite(repo.forks_count)
  const watchers = finite(repo.subscribers_count)
  const openIssues = finite(repo.open_issues_count)
  return {
    repository,
    ...stars === undefined ? {} : { stars },
    ...forks === undefined ? {} : { forks },
    ...watchers === undefined ? {} : { watchers },
    ...openIssues === undefined ? {} : { openIssues },
  }
}

/**
 * Sum the trailing weeks of a GitHub commit-activity series.
 * @param payload - Upstream `/repos/{owner}/{name}/stats/commit_activity` JSON.
 * @param weeks - Number of trailing weeks to sum.
 * @returns The commit count, or undefined while GitHub is still computing the series.
 */
export function normalizeGithubCommitActivity(payload: unknown, weeks = 4): number | undefined {
  if (!Array.isArray(payload) || payload.length === 0) return undefined
  const totals = payload.flatMap((entry) => {
    const week = record(entry)
    const total = finite(week?.total)
    return total === undefined ? [] : [total]
  })
  if (totals.length === 0) return undefined
  return totals.slice(-weeks).reduce((sum, value) => sum + value, 0)
}

/**
 * Count the releases published inside a trailing window and date the newest one.
 * @param payload - Upstream `/repos/{owner}/{name}/releases` JSON.
 * @param today - Date the window ends on.
 * @param windowDays - Length of the trailing window in days.
 * @returns The release count and the newest release date, or undefined when the feed published none.
 */
export function normalizeGithubReleases(
  payload: unknown,
  today: Date,
  windowDays: number,
): { readonly releases: number; readonly latestRelease: string } | undefined {
  if (!Array.isArray(payload)) return undefined
  const from = new Date(today.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10)
  const dates = payload.flatMap((entry) => {
    const published = record(entry)?.published_at
    return typeof published === 'string' && published.length >= 10 ? [published.slice(0, 10)] : []
  })
  if (dates.length === 0) return undefined
  const sorted = [...dates].sort()
  return {
    releases: sorted.filter(date => date >= from).length,
    latestRelease: sorted[sorted.length - 1] as string,
  }
}

/**
 * Read the first GitHub repository linked by a community snapshot.
 * @param repos - Repository URLs as published upstream.
 * @returns The `owner/name` slug, or undefined when no GitHub URL is usable.
 */
export function githubSlug(repos: readonly string[] | undefined): string | undefined {
  for (const url of repos ?? []) {
    const match = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(url)
    if (match !== null) return `${match[1] as string}/${(match[2] as string).replace(/\.git$/, '')}`
  }
  return undefined
}
