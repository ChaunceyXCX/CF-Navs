import { isAllowedBookmarkUrl } from '../../shared/urlPolicy'

export type BookmarkUrlTarget = {
  url: string
  internal_url?: string | null
}

export type BookmarkUrlProbeResult = {
  url: string
  latencyMs: number
  ok: boolean
}

export type BookmarkOpenMode = 'new_tab' | 'same_tab' | 'modal'

export type BookmarkUrlProbeOptions = {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type ChooseBookmarkUrlOptions = BookmarkUrlProbeOptions

export type BookmarkPopup = {
  opener: unknown
  location: { replace(url: string): void }
}

export type BookmarkWindowLike = {
  open(url?: string, target?: string, features?: string): BookmarkPopup | null
  location: { assign(url: string): void }
}

export type OpenBookmarkUrlOptions = ChooseBookmarkUrlOptions & {
  windowRef?: BookmarkWindowLike | null
  onModalUrl?: (url: string) => void
}

export const BOOKMARK_URL_PROBE_TIMEOUT_MS = 1200

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

async function attemptProbe(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<BookmarkUrlProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = nowMs()

  try {
    const response = await fetchImpl(url, {
      method,
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })

    // no-cors 响应是 opaque：status/ok 读不到，但 fetch resolve 说明目标可达。
    // 能测的只有到响应头返回的 RTT，因此这里不检查 response.ok。
    void response.body?.cancel?.().catch?.(() => undefined)
    return { url, latencyMs: nowMs() - startedAt, ok: true }
  } catch {
    return { url, latencyMs: nowMs() - startedAt, ok: false }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeBookmarkUrl(
  url: string,
  options: BookmarkUrlProbeOptions = {},
): Promise<BookmarkUrlProbeResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? BOOKMARK_URL_PROBE_TIMEOUT_MS

  if (!isAllowedBookmarkUrl(url)) {
    return { url, latencyMs: 0, ok: false }
  }

  const head = await attemptProbe(url, 'HEAD', timeoutMs, fetchImpl)
  if (head.ok) return head

  // 部分自建服务拒绝 HEAD，但允许轻量 GET；再给一次机会，避免误判成不可达。
  return await attemptProbe(url, 'GET', timeoutMs, fetchImpl)
}

function hasUsableInternalUrl(target: BookmarkUrlTarget): boolean {
  const internalUrl = typeof target.internal_url === 'string' ? target.internal_url.trim() : ''
  return Boolean(internalUrl && internalUrl !== target.url && isAllowedBookmarkUrl(internalUrl))
}

export async function chooseFastestBookmarkUrl(
  target: BookmarkUrlTarget,
  options: ChooseBookmarkUrlOptions = {},
): Promise<string> {
  const externalUrl = target.url
  const internalUrl = typeof target.internal_url === 'string' ? target.internal_url.trim() : ''

  if (!hasUsableInternalUrl(target)) {
    return externalUrl
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? BOOKMARK_URL_PROBE_TIMEOUT_MS
  const [external, internal] = await Promise.all([
    probeBookmarkUrl(externalUrl, { fetchImpl, timeoutMs }),
    probeBookmarkUrl(internalUrl, { fetchImpl, timeoutMs }),
  ])

  if (external.ok && internal.ok) {
    return internal.latencyMs < external.latencyMs ? internalUrl : externalUrl
  }
  if (internal.ok) return internalUrl
  return externalUrl
}

function currentWindow(): BookmarkWindowLike | null {
  if (typeof window === 'undefined') return null
  return window as unknown as BookmarkWindowLike
}

export async function openBookmarkUrl(
  target: BookmarkUrlTarget,
  mode: BookmarkOpenMode,
  options: OpenBookmarkUrlOptions = {},
): Promise<string> {
  const win = options.windowRef === undefined ? currentWindow() : options.windowRef
  let popup: BookmarkPopup | null = null
  const shouldProbe = hasUsableInternalUrl(target)

  // 没有内网备用地址时保持原来的导航方式：不额外发探测，也不先开空白窗口。
  // 有双地址时 window.open 必须在用户手势里同步调用，否则探测回来后会被 popup blocker 拦掉。
  if (shouldProbe && mode === 'new_tab' && win) {
    popup = win.open('', '_blank')
    if (popup) {
      try {
        popup.opener = null
      } catch {
        // 某些浏览器不允许改写 opener；noopener 兜底在失败分支里补。
      }
    }
  }

  let resolvedUrl = target.url
  if (shouldProbe) {
    try {
      resolvedUrl = await chooseFastestBookmarkUrl(target, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      })
    } catch {
      resolvedUrl = target.url
    }
  }

  if (mode === 'modal') {
    options.onModalUrl?.(resolvedUrl)
    return resolvedUrl
  }

  if (!win) return resolvedUrl

  if (mode === 'new_tab') {
    if (popup) {
      try {
        popup.location.replace(resolvedUrl)
        return resolvedUrl
      } catch {
        // about:blank 窗口已被关闭时退回普通 window.open。
      }
    }
    win.open(resolvedUrl, '_blank', 'noopener,noreferrer')
    return resolvedUrl
  }

  win.location.assign(resolvedUrl)
  return resolvedUrl
}
