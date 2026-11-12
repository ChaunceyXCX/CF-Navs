import { decodeHtmlEntities } from '../../shared/decodeHtmlEntities'
import { isAllowedBookmarkUrl, normalizeOptionalBookmarkUrl } from '../../shared/urlPolicy'

export type InternalBookmarkIconResult = {
  dataUri: string
  iconUrl: string
}

export type InternalBookmarkIconOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const MAX_HTML_BYTES = 131_072
export const MAX_UPLOAD_ICON_BYTES = 256_000
const DEFAULT_TIMEOUT_MS = 4000
const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.1'

function extractAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>`]+))', 'i')
  const match = tag.match(pattern)
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim() || null
}

function resolveSafeUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(decodeHtmlEntities(raw), baseUrl).toString()
    return isAllowedBookmarkUrl(url) ? url : null
  } catch {
    return null
  }
}

export function extractInternalIconCandidates(html: string, baseUrl: string): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = extractAttribute(tag, 'rel')
    const href = extractAttribute(tag, 'href')
    if (!rel || !href || !/\bicon\b/i.test(rel)) continue

    const resolved = resolveSafeUrl(href, baseUrl)
    if (!resolved || seen.has(resolved)) continue
    seen.add(resolved)
    candidates.push(resolved)
  }

  return candidates
}

export function extractInternalManifestUrl(html: string, baseUrl: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = extractAttribute(tag, 'rel')
    const href = extractAttribute(tag, 'href')
    if (!rel || !href || !/\bmanifest\b/i.test(rel)) continue
    return resolveSafeUrl(href, baseUrl)
  }
  return null
}

export function extractInternalRefreshUrl(html: string, baseUrl: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const httpEquiv = extractAttribute(tag, 'http-equiv')
    if (!httpEquiv || httpEquiv.trim().toLowerCase() !== 'refresh') continue

    const content = extractAttribute(tag, 'content')
    if (!content) continue

    const match = content.match(/\burl\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i)
    const raw = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
    if (!raw) continue
    return resolveSafeUrl(raw, baseUrl)
  }
  return null
}

export function extractInternalManifestIconUrls(manifest: unknown, baseUrl: string): string[] {
  if (!manifest || typeof manifest !== 'object') return []
  const icons = (manifest as { icons?: unknown }).icons
  if (!Array.isArray(icons)) return []

  const urls: string[] = []
  const seen = new Set<string>()
  for (const icon of icons) {
    if (!icon || typeof icon !== 'object') continue
    const src = (icon as { src?: unknown }).src
    if (typeof src !== 'string' || !src.trim()) continue
    const resolved = resolveSafeUrl(src, baseUrl)
    if (!resolved || seen.has(resolved)) continue
    seen.add(resolved)
    urls.push(resolved)
  }
  return urls
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function arrayBufferToDataUri(buffer: ArrayBuffer, declaredType: string): string {
  const bytes = new Uint8Array(buffer)
  const normalized = declaredType.split(';')[0]?.trim().toLowerCase() || ''
  const contentType = normalized.startsWith('image/') ? normalized : 'image/png'
  return `data:${contentType};base64,${bytesToBase64(bytes)}`
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, maxBytes)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const allowed = Math.min(value.byteLength, maxBytes - total)
      chunks.push(value.subarray(0, allowed))
      total += allowed
      if (allowed < value.byteLength) break
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(merged)
}

type FetchResult = { html: string; finalUrl: string }

async function fetchHtml(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FetchResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: HTML_ACCEPT },
    })
    if (!response.ok) return null
    const html = await readLimitedText(response, MAX_HTML_BYTES)
    return { html, finalUrl: response.url || url }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/manifest+json,application/json;q=0.9,*/*;q=0.1' },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchIconDataUri(
  iconUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<InternalBookmarkIconResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(iconUrl, {
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: IMAGE_ACCEPT },
    })
    if (!response.ok) return null

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_ICON_BYTES) return null

    const declared = response.headers?.get?.('content-type') ?? ''
    const normalized = declared.split(';')[0]?.trim().toLowerCase() || ''
    // 文本/HTML 几乎肯定是登录页；其他未知类型交给后端按真实字节嗅探。
    if (normalized.startsWith('text/') || normalized.includes('html')) return null

    return {
      dataUri: arrayBufferToDataUri(buffer, declared),
      iconUrl,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function parseInternalBookmarkIcon(
  rawUrl: string,
  options: InternalBookmarkIconOptions = {},
): Promise<InternalBookmarkIconResult | null> {
  const targetUrl = normalizeOptionalBookmarkUrl(rawUrl)
  if (!targetUrl) return null

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) return null
  const totalTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + totalTimeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())

  const firstPage = await fetchHtml(targetUrl, fetchImpl, remaining())
  if (!firstPage) return null

  const pages = [firstPage]
  const refreshUrl = extractInternalRefreshUrl(firstPage.html, firstPage.finalUrl)
  if (refreshUrl && refreshUrl !== firstPage.finalUrl) {
    const refreshed = await fetchHtml(refreshUrl, fetchImpl, remaining())
    if (refreshed) pages.push(refreshed)
  }

  const iconUrls: string[] = []
  const seen = new Set<string>()
  const addIconUrl = (url: string | null) => {
    if (!url || seen.has(url) || !isAllowedBookmarkUrl(url)) return
    seen.add(url)
    iconUrls.push(url)
  }

  for (const page of pages) {
    for (const candidate of extractInternalIconCandidates(page.html, page.finalUrl)) addIconUrl(candidate)
    const manifestUrl = extractInternalManifestUrl(page.html, page.finalUrl)
    if (manifestUrl) {
      const manifest = await fetchJson(manifestUrl, fetchImpl, remaining())
      for (const candidate of extractInternalManifestIconUrls(manifest, manifestUrl)) addIconUrl(candidate)
    }
    try {
      addIconUrl(new URL('/favicon.ico', page.finalUrl).toString())
    } catch {
      // 忽略非法 finalUrl
    }
  }

  for (const iconUrl of iconUrls) {
    if (Date.now() >= deadline) break
    const result = await fetchIconDataUri(iconUrl, fetchImpl, remaining())
    if (result) return result
  }

  return null
}

export async function fileToImageDataUri(
  file: Pick<File, 'type' | 'size' | 'arrayBuffer'>,
): Promise<string> {
  if (!file.type.toLowerCase().startsWith('image/')) {
    throw new Error('请选择图片文件')
  }
  if (file.size > MAX_UPLOAD_ICON_BYTES) {
    throw new Error('图标文件不能超过 256 KB')
  }

  const buffer = await file.arrayBuffer()
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_ICON_BYTES) {
    throw new Error('图标文件不能超过 256 KB')
  }

  return arrayBufferToDataUri(buffer, file.type)
}
