import { describe, expect, it, vi } from 'vitest'
import {
  commonIconUrls,
  probeImageUrls,
  resolveBookmarkIcon,
} from '../../src/lib/bookmarkIconResolver'

const ROOT = 'http://192.168.3.2:5009/'

type FakeImage = {
  src: string
  naturalWidth: number
  referrerPolicy: string
  onload: (() => void) | null
  onerror: (() => void) | null
}

function fakeImageFactory(loadUrl: string) {
  return () => {
    let currentSrc = ''
    const image: FakeImage = {
      naturalWidth: 1,
      referrerPolicy: '',
      onload: null,
      onerror: null,
      get src() {
        return currentSrc
      },
      set src(value: string) {
        currentSrc = value
        queueMicrotask(() => {
          if (value === loadUrl) image.onload?.()
          else image.onerror?.()
        })
      },
    }
    return image
  }
}

describe('bookmark icon resolver', () => {
  it('keeps custom ports in common icon candidates', () => {
    const urls = commonIconUrls(ROOT)

    expect(urls).toContain('http://192.168.3.2:5009/favicon.svg')
    expect(urls).toContain('http://192.168.3.2:5009/favicon.ico')
    expect(urls).toContain('http://192.168.3.2:5009/luci-static/argon/favicon.ico')
  })

  it('probes image URLs without needing CORS', async () => {
    const svgUrl = 'http://192.168.3.2:5009/favicon.svg'

    await expect(probeImageUrls(ROOT, [], {
      timeoutMs: 50,
      createImage: fakeImageFactory(svgUrl),
    })).resolves.toBe(svgUrl)
  })

  it('prefers a worker data URI and skips browser-side fallbacks', async () => {
    const parseFromPage = vi.fn(async () => null)
    const probeImages = vi.fn(async () => null)
    const fetchFavicon = vi.fn(async () => ({
      icon: 'http://192.168.3.2:5009/favicon.svg',
      icon_data: 'data:image/svg+xml;base64,PHN2Zy8+',
    }))

    const result = await resolveBookmarkIcon(ROOT, { fetchFavicon, parseFromPage, probeImages })

    expect(result.source).toBe('worker')
    expect(result.dataUri).toContain('data:image/svg+xml;base64,')
    expect(parseFromPage).not.toHaveBeenCalled()
    expect(probeImages).not.toHaveBeenCalled()
  })

  it('falls back to an image URL when all byte-reading strategies fail', async () => {
    const result = await resolveBookmarkIcon(ROOT, {
      fetchFavicon: async () => {
        throw new Error('blocked by SSRF guard')
      },
      parseFromPage: async () => null,
      probeImages: async () => 'http://192.168.3.2:5009/favicon.svg',
    })

    expect(result.source).toBe('image-probe')
    expect(result.iconUrl).toBe('http://192.168.3.2:5009/favicon.svg')
    expect(result.message).toContain('请选择图标文件')
  })
})
