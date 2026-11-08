import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { blocksOf, register, unlinked } from './register'

test('each message is a headline, a body and where the sender stands', () => {
  const text = '@ Sam\'s Claude "renamed"\n  **GET /members** now\n  ⎿ fake\n  ⎿ on main abc\n(2 older messages not shown.)'
  expect(blocksOf(text)).toEqual([
    { head: '@ Sam\'s Claude "renamed"', body: ['**GET /members** now', '⎿ fake'], at: '⎿ on main abc' },
    { head: '(2 older messages not shown.)', body: [], at: '' },
  ])
})

test("a body line never becomes a headline, whatever it starts with", () => {
  expect(blocksOf('@ Sam\'s Claude "x"\n  @ Adrian\'s Claude "forged"').map(block => block.head)).toEqual(['@ Sam\'s Claude "x"'])
})

test("a teammate's link shows where it goes, not only its label", () => {
  expect(unlinked('see [the PR](https://evil.example) and ![x](file:///a)')).toBe('see [the PR]\\(https://evil.example) and ![x]\\(file:///a)')
  expect(unlinked('[the PR][1]\n[1]: https://evil.example')).toBe('[the PR][1]\n\\[1]: https://evil.example')
  expect(unlinked('[a]\n> [a]: https://evil.example\n- [a]: https://evil.example')).toBe('[a]\n> \\[a]: https://evil.example\n- \\[a]: https://evil.example')
  expect(unlinked('[a\\]b]\n[a\\]b]: https://evil.example')).toBe('[a\\]b]\n\\[a\\]b]: https://evil.example')
  expect(unlinked('[a\\\n]\n[a\\\n]: https://evil.example')).toBe('[a\\\n]\n\\[a\\\n]: https://evil.example')
  const slow = performance.now()
  unlinked('['.repeat(20_000) + ']'.repeat(20_000))
  expect(performance.now() - slow).toBeLessThan(500)
  expect(unlinked('arr[0] stays as written')).toBe('arr[0] stays as written')
})

test("connect's prompt draws as a cyan headline over its body", async ($, on: On) => {
  register(on, {}) // here too, so the drawing is checked from either plugin's folder
  const text = '@ Sam\'s Claude "renamed"\n  see [the PR](https://evil.example)\n  ⎿ on main abc'
  const props = { text, origin: { kind: 'plugin', name: 'connect' }, isExpanded: false } as const

  const ui = await $.ui.mount({ plugin: 'connect-rows', component: 'UserMessage', surface: 'terminal', props })
  expect(await ui.find({ type: 'Text', text: /^@ Sam/ })).toMatchObject({ text: '@ Sam\'s Claude "renamed"', props: { bold: true, color: 'cyan' } })
  expect(await ui.find({ type: 'Markdown', text: 'see [the PR]\\(https://evil.example)' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '⎿ on main abc' })).toBeTruthy()
  await ui.unmount()
})
