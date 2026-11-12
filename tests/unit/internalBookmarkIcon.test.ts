import { describe, expect, it, vi } from 'vitest'
import {
  extractInternalIconCandidates,
  extractInternalManifestIconUrls,
  extractInternalManifestUrl,
  extractInternalRefreshUrl,
  fileToImageDataUri,
  parseInternalBookmarkIcon,
} from '../../src/lib/internalBookmarkIcon'

const PNG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10]
const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgo='

function textResponse(html: string, url: string): Response {
  return {
    ok: true,
    url,
    body: undefined,
    headers: { get: () => 'text/html' },
    text: async () => html,
  } as unknown as Response
}

function imageResponse(url: string, bytes: number[], contentType = 'image/png'): Response {
  return {
    ok: true,
    url,
    headers: { get: () => contentType },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response
}

function jsonResponse(url: string, data: unknown): Response {
  return {
    ok: true,
    url,
    headers: { get: () => 'application/manifest+json' },
    json: async () => data,
  } as unknown as Response
}

function missingResponse(): Response {
  return { ok: false, status: 404 } as unknown as Response
}

describe('internal bookmark icon html parsing', () => {
  const base = 'http://nas.local:8080/cgi-bin/luci/'

  it('keeps the port when resolving relative icon and refresh urls', () => {
    const html = `
      <meta http-equiv="refresh" content="0; URL=cgi-bin/luci/" />
      <link rel="shortcut icon" href="/luci-static/argon/favicon.ico" />
      <link rel="manifest" href="/manifest.json" />
    `

    expect(extractInternalRefreshUrl(html, 'http://nas.local:8080/'))
      .toBe('http://nas.local:8080/cgi-bin/luci/')
    expect(extractInternalIconCandidates(html, base))
      .toEqual(['http://nas.local:8080/luci-static/argon/favicon.ico'])
    expect(extractInternalManifestUrl(html, base)).toBe('http://nas.local:8080/manifest.json')
  })

  it('rejects script URLs from icon candidates and manifests', () => {
    expect(extractInternalIconCandidates(
      '<link rel="icon" href="javascript:alert(1)" />',
      base,
    )).toEqual([])
    expect(extractInternalManifestIconUrls({
      icons: [{ src: 'data:text/html,<script>alert(1)</script>' }],
    }, base)).toEqual([])
  })
})

describe('parseInternalBookmarkIcon', () => {
  it('follows a meta refresh and uploads the discovered icon as a data URI', async () => {
    const rootUrl = 'http://nas.local:8080/'
    const loginUrl = 'http://nas.local:8080/cgi-bin/luci/'
    const iconUrl = 'http://nas.local:8080/luci-static/argon/favicon.png'
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === rootUrl) {
        return textResponse('<meta http-equiv="refresh" content="0; URL=cgi-bin/luci/" />', rootUrl)
      }
      if (url === loginUrl) {
        return textResponse('<link rel="shortcut icon" href="/luci-static/argon/favicon.png" />', loginUrl)
      }
      if (url === iconUrl) return imageResponse(iconUrl, PNG_BYTES)
      return missingResponse()
    }) as unknown as typeof fetch

    const result = await parseInternalBookmarkIcon(rootUrl, { fetchImpl, timeoutMs: 1000 })

    expect(result).toEqual({ dataUri: PNG_DATA_URI, iconUrl })
  })

  it('parses manifest icons when HTML has no usable icon link', async () => {
    const rootUrl = 'http://nas.local:8080/'
    const manifestUrl = 'http://nas.local:8080/manifest.json'
    const iconUrl = 'http://nas.local:8080/icon-192.png'
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === rootUrl) return textResponse('<link rel="manifest" href="/manifest.json" />', rootUrl)
      if (url === manifestUrl) return jsonResponse(manifestUrl, { icons: [{ src: '/icon-192.png', sizes: '192x192' }] })
      if (url === iconUrl) return imageResponse(iconUrl, PNG_BYTES)
      return missingResponse()
    }) as unknown as typeof fetch

    const result = await parseInternalBookmarkIcon(rootUrl, { fetchImpl, timeoutMs: 1000 })

    expect(result).toEqual({ dataUri: PNG_DATA_URI, iconUrl })
  })

  it('returns null when the browser cannot read the internal page due to CORS', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('blocked by CORS')
    }) as unknown as typeof fetch

    await expect(parseInternalBookmarkIcon('http://nas.local:8080/', { fetchImpl, timeoutMs: 1000 }))
      .resolves.toBeNull()
  })
})

describe('fileToImageDataUri', () => {
  it('converts a small image file into a data URI', async () => {
    const file = {
      type: 'image/png',
      size: PNG_BYTES.length,
      arrayBuffer: async () => new Uint8Array(PNG_BYTES).buffer,
    }

    await expect(fileToImageDataUri(file)).resolves.toBe(PNG_DATA_URI)
  })

  it('rejects non-image and oversized files', async () => {
    const notImage = {
      type: 'text/plain',
      size: 10,
      arrayBuffer: async () => new Uint8Array(10).buffer,
    }
    const oversized = {
      type: 'image/png',
      size: 300_000,
      arrayBuffer: async () => new Uint8Array(300_000).buffer,
    }

    await expect(fileToImageDataUri(notImage)).rejects.toThrow('请选择图片文件')
    await expect(fileToImageDataUri(oversized)).rejects.toThrow('不能超过 256 KB')
  })
})
