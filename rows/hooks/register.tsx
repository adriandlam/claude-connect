import type { Register } from 'claude-code'

// Reads the shape `row` writes in connect's hooks/register.tsx, which a plugin that
// installs alone cannot import: a headline starting `@` at the margin, then indented
// lines, so a teammate's text can never reach the margin and pass for a headline.
export const register: Register = on => {
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const { origin, text } = e.props
    if (origin.kind !== 'plugin' || origin.name !== 'connect') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {text.split('\n').map((line, index) =>
          line.startsWith('@') ? (
            <Text key={String(index)} bold color="cyan">
              {line}
            </Text>
          ) : (
            <Text key={String(index)} dimColor={line.startsWith('  ⎿')}>
              {line}
            </Text>
          ),
        )}
      </Box>
    )
  })
}
