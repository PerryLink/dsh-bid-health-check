/**
 * Minimal first run for dsh-bid-health-check.
 *
 * Input: two files copied from the package's own synthetic test fixtures —
 * `pack.json` (a RequirementsPack produced by dsh-tender-requirements) and
 * `bid-sample.docx` (a synthetic bid document).
 *
 *   node samples/quickstart/run.mjs           human-readable summary
 *   node samples/quickstart/run.mjs --json    the same summary as JSON
 *   node samples/quickstart/run.mjs --check   compare against expected/result.json
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as plugin from '../../lib/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const registered = []
const ctx = { tools: { register: (tool) => { registered.push(tool); return () => {} } } }
plugin.apply(ctx, plugin.Config({}))
const tool = registered.find((t) => t.name === plugin.TOOL_NAME)
if (!tool) throw new Error('tool not registered: ' + plugin.TOOL_NAME)

const result = await tool.execute(
  {
    pack: join(here, 'input', 'pack.json'),
    file: join(here, 'input', 'bid-sample.docx'),
  },
  { signal: new AbortController().signal },
)

const summary = {
  tool: tool.name,
  summary: result.summary,
  blockedByPack: result.blockedByPack,
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2))
} else if (process.argv.includes('--check')) {
  const expected = JSON.parse(await readFile(join(here, 'expected', 'result.json'), 'utf8'))
  if (JSON.stringify(summary, null, 2) !== JSON.stringify(expected, null, 2)) {
    console.error('quickstart: output differs from expected/result.json')
    console.error('--- expected\n' + JSON.stringify(expected, null, 2))
    console.error('--- actual\n' + JSON.stringify(summary, null, 2))
    process.exit(1)
  }
  console.log(`${tool.name}: quickstart OK — output matches expected/result.json`)
} else {
  console.log('$ node samples/quickstart/run.mjs')
  console.log(
    `${tool.name}: ${summary.summary.responded} responded, ${summary.summary.weak} weak, ` +
      `${summary.summary.notLocated} not located (${summary.blockedByPack} blocked by pack)`,
  )
}
