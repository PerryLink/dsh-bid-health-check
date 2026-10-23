/**
 * Markdown for a bid health check.
 *
 * "Not located" is the section that matters. A report that listed only the
 * requirements it matched would read as a completeness verdict, and a bidder acting
 * on it would rewrite sections that were already written — in a table, an appendix,
 * or under different wording.
 */

import type { HealthResult } from './model.ts'

const HEALTH_LABEL = {
  responded: '看起来有响应',
  weak: '响应可疑',
  'not-located': '定位不到',
} as const

/**
 * Render the result as markdown.
 *
 * @param result - the check outcome.
 * @param packPath - the RequirementsPack path.
 * @param bidPath - the bid document path.
 * @returns markdown text.
 */
export function renderMarkdown(result: HealthResult, packPath: string, bidPath: string): string {
  const lines: string[] = []
  lines.push('# 投标文件体检')
  lines.push('')
  lines.push(`- 要求清单：${packPath}`)
  lines.push(`- 投标文件：${bidPath}`)
  lines.push(`- 条目：${result.requirements} 条`)
  lines.push(
    `- 结果：看起来有响应 ${result.summary.responded} · 响应可疑 ${result.summary.weak} · 定位不到 ${result.summary.notLocated}`,
  )
  if (result.blockedByPack > 0) lines.push(`- 因采购文件侧未解决而无法核对：${result.blockedByPack} 条`)
  lines.push('')
  lines.push('> **「定位不到」不等于「没写」。** 本工具只做词面定位：')
  lines.push('> 要求可能写在表格、附件里，或用了不同的说法。定位不到只说明本工具没找到。')
  lines.push('> 反过来，「看起来有响应」也不等于满足要求 —— 需要人去看那一段到底写了什么。')
  lines.push('')

  for (const health of ['not-located', 'weak', 'responded'] as const) {
    const items = result.items.filter((item) => item.health === health)
    if (items.length === 0) continue
    lines.push(`## ${HEALTH_LABEL[health]}（${items.length} 条）`)
    lines.push('')
    for (const item of items) {
      lines.push(`- **${item.id}** ${item.title}`)
      if (item.paragraph > 0) {
        lines.push(`  - 位置：第 ${item.paragraph} 段`)
        lines.push(`  - 原文：${item.evidence}`)
      }
      lines.push(`  - 判定：${item.reason}`)
    }
    lines.push('')
  }

  if (result.warnings.length > 0) {
    lines.push('## 提示')
    lines.push('')
    for (const warning of [...new Set(result.warnings)]) lines.push(`- ${warning}`)
    lines.push('')
  }

  lines.push('## 边界')
  lines.push('')
  lines.push('本报告只做**词面定位**，不判断投标文件是否满足要求，也不判断会不会被废标。')
  lines.push('它读不了表格、扫描件与附件；这些地方的响应不会被计入。')
  lines.push('采购文件侧的 C 队列条目未解决前，对应的投标侧核对没有意义，本工具会跳过并标注。')
  lines.push('')
  return lines.join('\n')
}

/** The result as a plain object for the JSON output. */
export function resultJson(result: HealthResult): Record<string, unknown> {
  return {
    requirements: result.requirements,
    summary: result.summary,
    blockedByPack: result.blockedByPack,
    items: result.items.map((item) => ({
      id: item.id,
      category: item.category,
      tier: item.tier,
      title: item.title,
      health: item.health,
      paragraph: item.paragraph,
      matchedTerm: item.matchedTerm,
      reason: item.reason,
    })),
    warnings: result.warnings,
  }
}
