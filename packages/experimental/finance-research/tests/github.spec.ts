import { describe, expect, it } from 'vitest'
import {
  githubSlug, normalizeGithubCommitActivity, normalizeGithubReleases, normalizeGithubRepo,
} from '../src/github.ts'

describe('GitHub normalization', () => {
  it('reads repository counts and trailing commit activity', () => {
    expect(normalizeGithubRepo({
      name: 'bitcoin',
      stargazers_count: 85_000,
      forks_count: 36_000,
      subscribers_count: 4_000,
      open_issues_count: 600,
    }, 'bitcoin/bitcoin')).toEqual({
      repository: 'bitcoin/bitcoin',
      stars: 85_000,
      forks: 36_000,
      watchers: 4_000,
      openIssues: 600,
    })

    expect(normalizeGithubCommitActivity([{ total: 10 }, { total: 20 }, { total: 30 }, { total: 40 }, { total: 50 }]))
      .toBe(140)
    expect(normalizeGithubCommitActivity([{ total: 7 }], 4)).toBe(7)
  })

  it('omits counts GitHub did not publish and rejects unusable payloads', () => {
    expect(normalizeGithubRepo({ name: 'bitcoin' }, 'bitcoin/bitcoin')).toEqual({ repository: 'bitcoin/bitcoin' })
    expect(normalizeGithubRepo(undefined, 'bitcoin/bitcoin')).toBeUndefined()
    expect(normalizeGithubRepo({ full_name: 'bitcoin/bitcoin' }, 'bitcoin/bitcoin')).toBeUndefined()
    expect(normalizeGithubCommitActivity([])).toBeUndefined()
    expect(normalizeGithubCommitActivity({})).toBeUndefined()
    expect(normalizeGithubCommitActivity([{ week: 1 }])).toBeUndefined()
  })

  it('counts the releases published inside the trailing window', () => {
    const today = new Date('2026-09-22T00:00:00.000Z')
    expect(normalizeGithubReleases([
      { published_at: '2026-08-15T10:00:00Z' },
      { published_at: '2026-05-02T10:00:00Z' },
      { published_at: '2024-01-02T10:00:00Z' },
      { draft: true },
    ], today, 365)).toEqual({ releases: 2, latestRelease: '2026-08-15' })
    expect(normalizeGithubReleases([{ published_at: '2024-01-02T10:00:00Z' }], today, 365))
      .toEqual({ releases: 0, latestRelease: '2024-01-02' })
  })

  it('reports no releases when the feed publishes none', () => {
    expect(normalizeGithubReleases([], new Date('2026-09-22T00:00:00.000Z'), 365)).toBeUndefined()
    expect(normalizeGithubReleases({}, new Date('2026-09-22T00:00:00.000Z'), 365)).toBeUndefined()
    expect(normalizeGithubReleases([{ draft: true }], new Date('2026-09-22T00:00:00.000Z'), 365)).toBeUndefined()
  })

  it('reads the first usable GitHub repository link', () => {
    expect(githubSlug(['https://github.com/bitcoin/bitcoin', 'https://github.com/bitcoin/bips'])).toBe('bitcoin/bitcoin')
    expect(githubSlug(['https://github.com/ethereum/go-ethereum.git'])).toBe('ethereum/go-ethereum')
    expect(githubSlug(['https://gitlab.com/x/y'])).toBeUndefined()
    expect(githubSlug([])).toBeUndefined()
    expect(githubSlug(undefined)).toBeUndefined()
  })
})
