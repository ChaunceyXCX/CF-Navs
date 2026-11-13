import type { FaviconResp } from '../../shared/types'
import { isAllowedBookmarkUrl, normalizeOptionalBookmarkUrl } from '../../shared/urlPolicy'
import { parseInternalBookmarkIcon, type InternalBookmarkIconResult } from './internalBookmarkIcon'

export type BookmarkIconResolution = {
  dataUri: string | null
  iconUrl: string | null
  message: string
  source: 'worker' | 'browser' | 'image-probe' | 'failed'
}

export type ResolveBookmarkIconDeps = {
  fetchFavicon: (url: string) => Promise<FaviconResp>
  parseFromPage?: (url: string) => Promise<InternalBookmarkIconResult | null>
  probeImages?: (url: string, extraUrls?: string[]) => Promise<string | null>
}

type ProbeImage = {
  src: string
  naturalWidth?: number
  referrerPolicy?: string
  onload: (() => void) | null
  onerror: (() => void) | null
}

export type ProbeImageUrlsOptions = {
  timeoutMs?: number
  createImage?: () => ProbeImage | null
}

const COMMON_ICON_PATHS = [
  '/favicon.svg',
  '/favicon.ico',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/logo.svg',
  '/logo.png',
  '/assets/favicon.svg',
  '/assets/favicon.ico',
  '/static/favicon.ico',
  // LuCI / OpenWrt 常见主题图标；meta refresh 目标页即使 403 也会声明这些路径。
  '/luci-static/argon/favicon.ico',
  '/luci-static/argon/icon/favicon-32x32.png',
  '/luci-static/argon/icon/android-icon-192x192.png',
]

export function commonIconUrls(rawUrl: string, extraUrls: string[] = []): string[] {
  const target = normalizeOptionalBookmarkUrl(rawUrl)
  if (!target) return []

  const origin = new URL(target).origin
  const urls = [
    ...extraUrls,
    ...COMMON_ICON_PATHS.map((path) => new URL(path, `${origin}/`).toString()),
  ]

  return [...new Set(urls.filter((url) => isAllowedBookmarkUrl(url)))]
}

function defaultCreateImage(): ProbeImage | null {
  if (typeof Image === 'undefined') return null
  return new Image() as unknown as ProbeImage
}

function probeOneImage(
  url: string,
  timeoutMs: number,
  createImage: () => ProbeImage | null,
): Promise<string | null> {
  return new Promise((resolve) => {
    const image = createImage()
    if (!image) {
      resolve(null)
      return
    }

    let settled = false
    const state: { timer?: ReturnType<typeof setTimeout> } = {}
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (state.timer) clearTimeout(state.timer)
      image.onload = null
      image.onerror = null
      resolve(ok ? url : null)
    }
    state.timer = setTimeout(() => finish(false), timeoutMs)

    image.onload = () => {
      const width = image.naturalWidth
      finish(typeof width !== 'number' || width > 0)
    }
    image.onerror = () => finish(false)
    image.referrerPolicy = 'no-referrer'
    image.src = url
  })
}

export async function probeImageUrls(
  rawUrl: string,
  extraUrls: string[] = [],
  options: ProbeImageUrlsOptions = {},
): Promise<string | null> {
  const urls = commonIconUrls(rawUrl, extraUrls)
  if (urls.length === 0) return null

  const createImage = options.createImage ?? defaultCreateImage
  const timeoutMs = options.timeoutMs ?? 1500
  const results = await Promise.all(urls.map((url) => probeOneImage(url, timeoutMs, createImage)))
  return results.find((url): url is string => Boolean(url)) ?? null
}

function isFaviconImFallback(iconUrl: string): boolean {
  try {
    const hostname = new URL(iconUrl).hostname.toLowerCase()
    return hostname === 'favicon.im' || hostname.endsWith('.favicon.im')
  } catch {
    return false
  }
}

export async function resolveBookmarkIcon(
  rawUrl: string,
  deps: ResolveBookmarkIconDeps,
): Promise<BookmarkIconResolution> {
  const target = normalizeOptionalBookmarkUrl(rawUrl)
  if (!target) {
    return { dataUri: null, iconUrl: null, message: '地址为空或非法。', source: 'failed' }
  }

  let extraIconUrl: string | null = null

  // 1) 同域 Worker：绕过浏览器 CORS / mixed-content，并直接返回可缓存的 data URI。
  try {
    const backend = await deps.fetchFavicon(target)
    if (backend.icon_data) {
      return {
        dataUri: backend.icon_data,
        iconUrl: backend.icon,
        message: '已通过服务端解析图标，保存后写入后端缓存。',
        source: 'worker',
      }
    }
    if (backend.icon && !isFaviconImFallback(backend.icon)) {
      extraIconUrl = backend.icon
    }
  } catch {
    // 内网地址会被 Worker 的 SSRF 过滤拒绝；继续走浏览器侧解析。
  }

  // 2) 浏览器侧 CORS 解析：同样适合本地/局域网 HTTP 部署。
  const parseFromPage = deps.parseFromPage ?? parseInternalBookmarkIcon
  try {
    const local = await parseFromPage(target)
    if (local?.dataUri) {
      return {
        dataUri: local.dataUri,
        iconUrl: local.iconUrl,
        message: '已在浏览器侧解析图标，保存后写入后端缓存。',
        source: 'browser',
      }
    }
    if (local?.iconUrl) extraIconUrl = local.iconUrl
  } catch {
    // 继续尝试 <img> 探测。
  }

  // 3) 无 CORS 兜底：用 <img> 探测常见图标路径。能显示，但不一定能读到字节写入后端。
  const probeImages = deps.probeImages ?? ((url, extra) => probeImageUrls(url, extra))
  try {
    const iconUrl = await probeImages(target, extraIconUrl ? [extraIconUrl] : [])
    if (iconUrl) {
      return {
        dataUri: null,
        iconUrl,
        message: '已识别图标地址，但浏览器不允许读取文件内容；如需写入后端缓存，请选择图标文件。',
        source: 'image-probe',
      }
    }
  } catch {
    // 落入最终失败提示。
  }

  return {
    dataUri: null,
    iconUrl: null,
    message: '自动解析失败（可能是 CORS、混合内容、证书或登录页限制），请选择图标文件。',
    source: 'failed',
  }
}
