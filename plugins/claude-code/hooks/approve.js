// Reads run without interrupting; writes still ask. A memory lookup that needs
// a permission prompt is a lookup the user learns to turn off.
const { readStdin, write, pass, MARK } = require('./lib/io')

// Plugin-scoped, directly configured, and connector spellings of the same tool.
const TOOL = /^mcp__(?:plugin_gitloom_|claude_ai_)?gitloom__(.+)$/
const READ_ONLY = new Set(['recall_memory', 'find_skill'])

async function main() {
  const input = await readStdin()
  const tool = TOOL.exec(input.tool_name || '')?.[1]
  if (!tool || !READ_ONLY.has(tool)) return pass()

  const q = input.tool_input?.query || input.tool_input?.task
  write({
    systemMessage: q ? `${MARK} gitloom · ${tool === 'find_skill' ? 'finding skill' : 'recalling'}: ${q}` : `${MARK} gitloom · recalling`,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Read-only memory access runs automatically.',
    },
  })
}

main().catch(() => pass())
