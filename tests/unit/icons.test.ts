import { describe, expect, it } from 'vitest'
import {
  defaultIconifyIcon,
  directFaviconIcon,
  faviconImIcon,
  getHost,
  getHostname,
  getIconCandidates,
  googleIcon,
  hasExplicitPort,
  iconifyIcon,
  iconifyNameFromUrl,
  iconifyProxyIcon,
  isIconifyIconUrl,
} from '../../src/lib/icons'

describe('icon helpers', () => {
  it('extracts normalized hostnames and favicon URLs', () => {
    expect(getHostname('https://www.example.com/path')).toBe('example.com')
    expect(getHostname('not a url')).toBe('')
    expect(faviconImIcon('https://www.example.com/path')).toBe('https://favicon.im/example.com?larger=true')
    expect(googleIcon('https://example.com', 128)).toBe('https://favicon.im/example.com?larger=true')
  })

  it('normalizes Iconify names and known Iconify URLs', () => {
    expect(iconifyIcon('mdi/home')).toBe('https://api.iconify.design/mdi/home.svg')
    expect(iconifyIcon('@iconify-json/logos/github-icon')).toBe('https://api.iconify.design/logos/github-icon.svg')
    expect(iconifyProxyIcon('iconify:logos:github-icon')).toBe('/api/iconify/logos/github-icon.svg')
    expect(iconifyNameFromUrl('https://api.iconify.design/logos/github-icon.svg?color=black')).toBe('logos:github-icon')
    expect(iconifyNameFromUrl('https://icon-sets.iconify.design/logos/github-icon/')).toBe('logos:github-icon')
    expect(isIconifyIconUrl('https://api.iconify.design/logos/github-icon.svg')).toBe(true)
    expect(isIconifyIconUrl('https://example.com/logos/github-icon.svg')).toBe(false)
  })

  it('derives simple-icons candidates from bookmark domains', () => {
    expect(defaultIconifyIcon('https://github.com/openai')).toBe('https://api.iconify.design/simple-icons/github.svg')
    expect(defaultIconifyIcon('invalid')).toBe('')
  })

  it('keeps custom ports for direct favicon candidates', () => {
    const url = 'http://3965.chauncey.top:5999'

    expect(getHost(url)).toBe('3965.chauncey.top:5999')
    expect(hasExplicitPort(url)).toBe(true)
    expect(directFaviconIcon(url)).toBe('http://3965.chauncey.top:5999/favicon.ico')
    expect(getIconCandidates(url, 'LuCI')[0]).toMatchObject({
      source: 'direct',
      url: 'http://3965.chauncey.top:5999/favicon.ico',
    })
    expect(defaultIconifyIcon(url)).toBe('')
  })
})
