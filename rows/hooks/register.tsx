import type { Register } from 'claude-code'

// Reads the shape `row` writes in connect's hooks/register.tsx, which a plugin that
// installs alone cannot import: a headline at the margin, then the body and where the
// sender stands, each line indented, so a teammate's text can never pass for a headline.
export function blocksOf(text: string) {
  const blocks: { head: string; body: string[]; at: string }[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith(' ') || !blocks.length) blocks.push({ head: line.trimStart(), body: [], at: '' })
    else blocks.at(-1)!.body.push(line.slice(2))
  }
  for (const block of blocks) if (block.body.at(-1)?.startsWith('⎿ ')) block.at = block.body.pop()!
  return blocks
}

// A teammate's link would show only its label, so its syntax is drawn as text, target and all:
// an inline link by escaping its `(`, and every reference definition by escaping each `[`
// before a line's first backtick, since a definition always opens its line. The rest of the
// line is left alone, so code like `arr[0]` draws as written.
export const unlinked = (text: string) =>
  text.replace(/\]\(/g, ']\\(').replace(/^[^`\n]*/gm, line => line.replace(/(?<!\\)((?:\\\\)*)\[/g, '$1\\['))

export const register: Register = on => {
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const { origin, text } = e.props
    if (origin.kind !== 'plugin' || origin.name !== 'connect') return next(e)

    const { Box, Text, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {blocksOf(text).map(({ head, body, at }, index) => (
          <Box key={String(index)} flexDirection="column">
            {head.startsWith('@') ? (
              <Text bold color="cyan">
                {head}
              </Text>
            ) : (
              <Text dimColor>{head}</Text>
            )}
            {body.length > 0 && (
              <Box paddingLeft={2}>
                <Markdown text={unlinked(body.join('\n'))} />
              </Box>
            )}
            {at && (
              <Box paddingLeft={2}>
                <Text dimColor>{at}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
