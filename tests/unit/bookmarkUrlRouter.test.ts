import { describe, expect, it, vi } from 'vitest'
import {
  chooseFastestBookmarkUrl,
  openBookmarkUrl,
  type BookmarkPopup,
  type BookmarkWindowLike,
} from '../../src/lib/bookmarkUrlRouter'

function opaqueResponse(): Response {
  return { ok: false, body: null } as unknown as Response
}

function fetchWithDelays(delays: Record<string, number>, failing: string[] = []): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (failing.includes(url)) throw new Error('network error')
    await new Promise((resolve) => setTimeout(resolve, delays[url] ?? 5))
    return opaqueResponse()
  }) as unknown as typeof fetch
}

const external = 'https://example.com'
const internal = 'http://192.168.1.10:8080'

describe('chooseFastestBookmarkUrl', () => {
  it('returns the external url without probing when no internal url exists', async () => {
    const fetchImpl = fetchWithDelays({})

    await expect(chooseFastestBookmarkUrl({ url: external }, { fetchImpl })).resolves.toBe(external)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects invalid internal urls and keeps the external one', async () => {
    const fetchImpl = fetchWithDelays({})

    await expect(chooseFastestBookmarkUrl(
      { url: external, internal_url: 'javascript:alert(1)' },
      { fetchImpl },
    )).resolves.toBe(external)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('selects the internal url when it responds faster', async () => {
    const fetchImpl = fetchWithDelays({ [external]: 40, [internal]: 5 })

    await expect(chooseFastestBookmarkUrl(
      { url: external, internal_url: internal },
      { fetchImpl, timeoutMs: 200 },
    )).resolves.toBe(internal)
  })

  it('selects the external url when it responds faster', async () => {
    const fetchImpl = fetchWithDelays({ [external]: 5, [internal]: 40 })

    await expect(chooseFastestBookmarkUrl(
      { url: external, internal_url: internal },
      { fetchImpl, timeoutMs: 200 },
    )).resolves.toBe(external)
  })

  it('falls back to external when only external probing succeeds', async () => {
    const fetchImpl = fetchWithDelays({ [external]: 5 }, [internal])

    await expect(chooseFastestBookmarkUrl(
      { url: external, internal_url: internal },
      { fetchImpl, timeoutMs: 200 },
    )).resolves.toBe(external)
  })

  it('falls back to internal when only internal probing succeeds', async () => {
    const fetchImpl = fetchWithDelays({ [internal]: 5 }, [external])

    await expect(chooseFastestBookmarkUrl(
      { url: external, internal_url: internal },
      { fetchImpl, timeoutMs: 200 },
    )).resolves.toBe(internal)
  })
})

describe('openBookmarkUrl', () => {
  it('opens a blank window synchronously and navigates it to the fastest url', async () => {
    const fetchImpl = fetchWithDelays({ [external]: 40, [internal]: 5 })
    const popup: BookmarkPopup = {
      opener: {},
      location: { replace: vi.fn() },
    }
    const win: BookmarkWindowLike = {
      open: vi.fn((url?: string) => (url === '' ? popup : null)),
      location: { assign: vi.fn() },
    }

    const resolved = await openBookmarkUrl(
      { url: external, internal_url: internal },
      'new_tab',
      { fetchImpl, timeoutMs: 200, windowRef: win },
    )

    expect(resolved).toBe(internal)
    expect(win.open).toHaveBeenCalledWith('', '_blank')
    expect(popup.opener).toBeNull()
    expect(popup.location.replace).toHaveBeenCalledWith(internal)
  })

  it('does not navigate the current page when a popup is blocked', async () => {
    const win: BookmarkWindowLike = {
      open: vi.fn(() => null),
      location: { assign: vi.fn() },
    }

    await openBookmarkUrl({ url: external }, 'new_tab', { windowRef: win })

    expect(win.open).toHaveBeenCalledWith(external, '_blank', 'noopener,noreferrer')
    expect(win.location.assign).not.toHaveBeenCalled()
  })

  it('hands the resolved url to modal callers', async () => {
    const fetchImpl = fetchWithDelays({ [external]: 40, [internal]: 5 })
    const onModalUrl = vi.fn()

    const resolved = await openBookmarkUrl(
      { url: external, internal_url: internal },
      'modal',
      { fetchImpl, timeoutMs: 200, windowRef: null, onModalUrl },
    )

    expect(resolved).toBe(internal)
    expect(onModalUrl).toHaveBeenCalledWith(internal)
  })
})
