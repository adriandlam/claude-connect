import type { Register } from 'claude-code'

// connect writes each message as `@name "summary"` at the margin, then indented
// lines, so a teammate's text can never reach the margin and pass for a header.
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
