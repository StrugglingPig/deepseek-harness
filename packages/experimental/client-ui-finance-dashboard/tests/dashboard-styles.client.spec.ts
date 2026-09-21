/**
 * The dashboard's scroll container and chart height as CSS text. jsdom has no
 * layout, so the rendering specs pin the DOM the selectors key on but cannot
 * show that an over-tall dashboard scrolls instead of clipping, and that the
 * chart reserves room for all four panes and its time axis.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../src/client/FinanceDashboard.module.css', import.meta.url)),
  'utf8',
)

function declarationsFrom(selector: string): string[] {
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('finance dashboard styles', () => {
  it('scrolls inside the fixed-height centre column instead of clipping the page', () => {
    expect(declarationsFrom('.root')).toEqual(expect.arrayContaining([
      // The centre column is a fixed-height flex parent with overflow hidden, so
      // the panel owns the scrollport; `min-height: 0` is what lets it stay at
      // the column height rather than grow past it.
      'height: 100%',
      'min-height: 0',
      'overflow-y: auto',
    ]))
  })

  it('reserves chart height for the price, volume, RSI, and MACD panes', () => {
    expect(declarationsFrom('.chart')).toEqual(expect.arrayContaining([
      // Four panes plus the time axis: below this the last panes and the axis
      // fall outside the chart box.
      'flex: 1 1 auto',
      'min-height: 600px',
    ]))
    expect(declarationsFrom('.nativeChart')).toEqual(expect.arrayContaining(['height: 100%']))
  })
})
