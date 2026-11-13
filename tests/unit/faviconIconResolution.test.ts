import { afterEach, describe, expect, it, vi } from 'vitest'
import { faviconRoutes } from '../../worker/routes/favicon'

const ROOT_URL = 'https://router.example.com:5999/'
const REFRESH_URL = 'https://router.example.com:5999/cgi-bin/luci/'
const ICON_URL = 'https://router.example.com:5999/luci-static/argon/favicon.ico'
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html' },
  })
}

function iconResponse(method: string): Response {
  if (method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
  }
  return new Response(PNG_BYTES, {
    status: 200,
    headers: { 'content-type': 'image/png' },
  })
}

describe('fetch-favicon route icon resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows a 403 HTML meta-refresh page and returns a safe icon data URI', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()

      if (url === ROOT_URL && method === 'GET') {
        return htmlResponse('<meta http-equiv="refresh" content="0; URL=cgi-bin/luci/" />')
      }
      if (url === REFRESH_URL && method === 'GET') {
        return htmlResponse('<link rel="icon" href="/luci-static/argon/favicon.ico" />', 403)
      }
      if (url === ICON_URL && (method === 'HEAD' || method === 'GET')) {
        return iconResponse(method)
      }
      return new Response('not found', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await faviconRoutes.request(
      `http://localhost/fetch-favicon?url=${encodeURIComponent(ROOT_URL)}`,
      {},
      {} as never,
    )
    const body = await response.json() as { data?: { icon?: string; icon_data?: string | null } }

    expect(body.data?.icon).toBe(ICON_URL)
    expect(body.data?.icon_data).toMatch(/^data:image\/png;base64,/)
  })
})
