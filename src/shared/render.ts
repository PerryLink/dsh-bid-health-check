/**
 * Markdown rendering of a {@link Report} for the model-facing tool result.
 *
 * The renderer is the only place that turns structured findings into prose, so
 * it is also the place where the wording guard is enforced: rendering throws if
 * a forbidden adjudicating phrase would reach the model.
 */

import { DISCLAIMER, findForbiddenWording } from './wording.ts'
import type { Issue, Locator, Report, Severity } from './report.ts'

const SEVERITY_LABEL: Record<Severity, string> = {
  error: '错误',
  warn: '提示',
  info: '参考',
}

/** Render one locator as a compact human-readable suffix. */
export function formatLocator(locator: Locator): string {
  const parts: string[] = []
  if (locator.file !== undefined) parts.push(locator.file)
  if (locator.page !== undefined) parts.push(`第${locator.page}页`)
  if (locator.line !== undefined) parts.push(`第${locator.line}行`)
  if (locator.para !== undefined) parts.push(`第${locator.para}段`)
  if (locator.row !== undefined) parts.push(`第${locator.row}行数据`)
  if (locator.cell !== undefined) parts.push(`单元格${locator.cell}`)
  if (locator.column !== undefined) parts.push(`字段${locator.column}`)
  return parts.length === 0 ? '(未定位)' : parts.join(' · ')
}

/** Render a single issue as one Markdown list item plus indented details. */
export function formatIssue(issue: Issue): string {
  const lines: string[] = []
  lines.push(`- **[${SEVERITY_LABEL[issue.severity]}] ${issue.ruleId}** — ${formatLocator(issue.locator)}`)
  lines.push(`  - 实际：${issue.found}`)
  lines.push(`  - 依据要求：${issue.expected}`)
  lines.push(`  - 条款依据：${issue.basis}`)
  if (issue.fix !== undefined) lines.push(`  - 建议核对：${issue.fix}`)
  if (issue.engine !== undefined) {
    lines.push(`  - 检索引擎：${issue.engine}${issue.engineVersion === undefined ? '' : `@${issue.engineVersion}`}`)
  }
  lines.push(`  - 编号：\`${issue.id}\``)
  return lines.join('\n')
}

/**
 * Render a report as Markdown.
 * @param report - canonical report value.
 * @returns Markdown text ending with the mandatory disclaimer.
 */
export function renderMarkdown(report: Report): string {
  const lines: string[] = []
  lines.push(`# ${report.plugin} 检查结果`)
  lines.push('')
  lines.push(`- 检查对象：${report.target}`)
  lines.push(`- 检查时间：${report.checkedAt}`)
  lines.push(`- 规则集版本：${report.rulesetVersion}`)
  lines.push(
    `- 结果统计：错误 ${report.summary.error} · 提示 ${report.summary.warn} · 参考 ${report.summary.info}` +
      ` · 共 ${report.issues.length} 条`,
  )
  lines.push('')

  if (report.issues.length === 0) {
    lines.push('## 明细')
    lines.push('')
    lines.push('本次规则集覆盖的检查项未产生差异条目。')
    lines.push('')
  } else {
    lines.push('## 明细')
    lines.push('')
    for (const issue of report.issues) {
      lines.push(formatIssue(issue))
      lines.push('')
    }
  }

  lines.push('## 未执行的检查')
  lines.push('')
  if (report.skipped.length === 0) {
    lines.push('规则集声明的全部检查项均已执行。')
  } else {
    lines.push('以下检查项因材料不足或前置条件不满足而未执行，其结论不包含在本报告中：')
    lines.push('')
    for (const entry of report.skipped) lines.push(`- \`${entry.rule}\`：${entry.reason}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(DISCLAIMER)

  const text = lines.join('\n')
  const hits = findForbiddenWording(text)
  if (hits.length > 0) {
    throw new Error(`renderMarkdown: forbidden adjudicating wording in output: ${hits.join(', ')}`)
  }
  return text
}
