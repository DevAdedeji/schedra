import { writeFileSync } from 'node:fs'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'

const INK = '#1C1917'
const MUTED = '#57534E'
const PAPER = '#FAFAF9'
const VERMILLION = '#FF3D00'

// Static cuts: satori's parser cannot read variable fonts (it throws in
// parseFvarAxis), and Google's copy of Figtree is variable-only.
const FONTS = {
  serif: 'https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf',
  sans: 'https://raw.githubusercontent.com/erikdkennedy/figtree/master/fonts/ttf/Figtree-Regular.ttf',
  sansBold: 'https://raw.githubusercontent.com/erikdkennedy/figtree/master/fonts/ttf/Figtree-SemiBold.ttf'
}

async function loadFont(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`)

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.subarray(0, 4).toString('hex') !== '00010000') {
    throw new Error(`not a TrueType file: ${url}`)
  }
  return buffer
}

const box = (style, children) => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children }
})
const text = (style, value) => ({ type: 'div', props: { style, children: value } })

const mark = box(
  { position: 'relative', width: 60, height: 60, display: 'flex', border: `4px solid ${INK}` },
  [
    box({ position: 'absolute', left: 24, top: 0, width: 4, height: 52, backgroundColor: INK }, []),
    box({ position: 'absolute', left: 0, top: 24, width: 52, height: 4, backgroundColor: INK }, []),
    box({ position: 'absolute', left: 28, top: 28, width: 24, height: 24, backgroundColor: VERMILLION }, [])
  ]
)

const template = box(
  {
    width: 1200,
    height: 630,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    backgroundColor: PAPER,
    padding: 72,
    fontFamily: 'Figtree'
  },
  [
    box({ display: 'flex', alignItems: 'center', gap: 18 }, [
      mark,
      text({ fontSize: 36, fontWeight: 600, color: INK, letterSpacing: '-0.03em' }, 'schedra')
    ]),

    box({ display: 'flex', flexDirection: 'column' }, [
      box({ display: 'flex', fontFamily: 'Instrument Serif', fontSize: 116, color: INK, lineHeight: 1.02 }, [
        text({}, 'Share a link. '),
        text({ color: VERMILLION }, 'Get booked.')
      ]),
      text(
        { marginTop: 26, fontSize: 30, color: MUTED, lineHeight: 1.45, maxWidth: 880 },
        'People pick a time that suits you both. It lands in your calendar, with reminders sent and timezones handled.'
      )
    ]),

    box({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
      text({ fontSize: 24, fontWeight: 600, color: MUTED }, 'Free · Open source · Self-hostable'),
      box({ display: 'flex', gap: 10 }, [
        box({ width: 44, height: 10, backgroundColor: VERMILLION }, []),
        box({ width: 44, height: 10, backgroundColor: '#E7E5E4' }, []),
        box({ width: 44, height: 10, backgroundColor: '#E7E5E4' }, [])
      ])
    ])
  ]
)

const [sans, sansBold, serif] = await Promise.all([
  loadFont(FONTS.sans),
  loadFont(FONTS.sansBold),
  loadFont(FONTS.serif)
])

const svg = await satori(template, {
  width: 1200,
  height: 630,
  fonts: [
    { name: 'Figtree', data: sans, weight: 400, style: 'normal' },
    { name: 'Figtree', data: sansBold, weight: 600, style: 'normal' },
    { name: 'Instrument Serif', data: serif, weight: 400, style: 'normal' }
  ]
})

const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
writeFileSync('public/og.png', png)
console.log(`public/og.png written — ${(png.length / 1024).toFixed(0)}KB`)
