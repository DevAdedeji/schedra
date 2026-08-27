import { describe, expect, it } from 'vitest'
import {
  embedPathForBookingPath,
  normalizeEmbedAccent,
  normalizeEmbedTheme,
  normalizeParentOrigin
} from '../../shared/embed'

describe('embed configuration', () => {
  it('maps personal and team booking paths to isolated embed routes', () => {
    expect(embedPathForBookingPath('/ada/design-review')).toBe('/embed/personal/ada/design-review')
    expect(embedPathForBookingPath('/team/acme/product-demo?utm_source=site')).toBe('/embed/team/acme/product-demo')
    expect(() => embedPathForBookingPath('/dashboard')).toThrow('personal or team event-type')
  })

  it('accepts only explicit themes and six-digit colours', () => {
    expect(normalizeEmbedTheme('dark')).toBe('dark')
    expect(normalizeEmbedTheme('sepia')).toBe('auto')
    expect(normalizeEmbedAccent('#ff3d00')).toBe('#FF3D00')
    expect(normalizeEmbedAccent('red')).toBeNull()
  })

  it('accepts only web origins for parent messaging', () => {
    expect(normalizeParentOrigin('https://example.com/path')).toBe('https://example.com')
    expect(normalizeParentOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeParentOrigin('javascript:alert(1)')).toBeNull()
    expect(normalizeParentOrigin('*')).toBeNull()
    expect(normalizeParentOrigin('null')).toBeNull()
  })
})
