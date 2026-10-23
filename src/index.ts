import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ingestDocx } from 'dsh-table-ingest/api'
import { Config } from './config.ts'
import type { Config as ConfigShape } from './config.ts'
import { check, readPack, readPackYaml } from './model.ts'
import { renderMarkdown, resultJson } from './report.ts'

export const name = 'dsh-bid-health-check'
export const inject = ['tools']
export { Config }

/** Tool id exposed to the model, and the row id in `cordis.patch.yml`. */
export const TOOL_NAME = 'bid_health_check'

/**
 * Register the bid health tool.
 *
 * @param ctx - plugin context, with `tools` already available.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: ConfigShape): () => void {
  return ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description:
        '读一份 RequirementsPack（由 dsh-tender-requirements 生成）与一份投标文件 .docx，' +
        '逐条报告哪些要求看起来有响应、哪些响应可疑、哪些定位不到。' +
        '只做词面定位：定位不到不等于没写，有响应也不等于满足要求。不判断会不会被废标。',
      parameters: {
        pack: { type: 'string', description: 'RequirementsPack 文件路径（JSON，或含 items 数组的 YAML）。' },
        file: { type: 'string', description: '投标文件 .docx 的绝对路径。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plugin: { type: 'string' },
            target: { type: 'string' },
            pack: { type: 'string' },
            summary: {
              type: 'object',
              additionalProperties: false,
              properties: {
                responded: { type: 'integer' },
                weak: { type: 'integer' },
                notLocated: { type: 'integer' },
              },
            },
            blockedByPack: { type: 'integer' },
            markdown: { type: 'string' },
            resultJson: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: (value as { markdown: string }).markdown }],
      },
      timeoutMs: config.timeoutMs,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (args.pack === undefined || args.pack.trim() === '') throw new Error('必须提供 pack（RequirementsPack 路径）')
        if (args.file === undefined || args.file.trim() === '') throw new Error('必须提供 file（投标文件 .docx）')
        const packPath = resolve(args.pack)
        const bidPath = resolve(args.file)
        exec.signal.throwIfAborted()

        const packText = await readFile(packPath, 'utf8')
        const pack = packText.trimStart().startsWith('{') ? readPack(packText) : readPackYaml(packText)
        const buffer = await readFile(bidPath)
        exec.signal.throwIfAborted()

        const paragraphs = ingestDocx(buffer, bidPath).paragraphs
        const result = check(pack.requirements, paragraphs)
        return {
          plugin: name,
          target: bidPath,
          pack: packPath,
          summary: result.summary,
          blockedByPack: result.blockedByPack,
          markdown: renderMarkdown(result, packPath, bidPath),
          resultJson: JSON.stringify(resultJson(result)),
        }
      },
    }),
  )
}
