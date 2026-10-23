/**
 * Model-facing projection of a {@link Report}.
 *
 * `buildView` is pure and covers the whole canonical output shape, so both the
 * tool's `output.render` and the test suite exercise exactly what the model
 * reads. `output.schema` in `index.ts` mirrors these keys.
 */

import { canonicalJson } from './shared/report.ts'
import { DISCLAIMER } from './shared/wording.ts'
import type { Issue, Report, Severity } from './shared/report.ts'

const SEVERITY_ORDER: readonly Severity[] = ['error', 'warn', 'info']

/** Markdown rendering of the canonical report, kept column-free for models. */
export interface ReportView {
  plugin: string
  target: string
  checkedAt: string
  rulesetVersion: string
  summary: { error: number; warn: number; info: number }
  issueCount: number
  skippedCount: number
  markdown: string
  reportJson: string
}

function issueLines(issues: readonly Issue[]): string[] {
  const lines: string[] = []
  for (const severity of SEVERITY_ORDER) {
    const group = issues.filter((issue) => issue.severity === severity)
    if (group.length === 0) continue
    lines.push(`### ${severity}（${group.length} 条）`)
    lines.push('')
    for (const issue of group) {
      const where: string[] = []
      if (issue.locator.file !== undefined) where.push(issue.locator.file)
      if (issue.locator.row !== undefined) where.push(`第${issue.locator.row}行`)
      if (issue.locator.page !== undefined) where.push(`第${issue.locator.page}页`)
      if (issue.locator.cell !== undefined) where.push(issue.locator.cell)
      if (issue.locator.column !== undefined) where.push(`字段 ${issue.locator.column}`)
      lines.push(`- \`${issue.ruleId}\` ${where.length === 0 ? '' : `[${where.join(' · ')}] `}${issue.found}`)
      lines.push(`  - 依据：${issue.expected}`)
      lines.push(`  - 条款：${issue.basis}`)
      if (issue.fix !== undefined) lines.push(`  - 建议核对：${issue.fix}`)
    }
    lines.push('')
  }
  return lines
}

/**
 * Build the model-facing view of a report.
 * @param report - canonical report value.
 * @returns the structured view consumed by `output.render` and by tests.
 */
export function buildView(report: Report): ReportView {
  const lines: string[] = []
  lines.push(`# ${report.plugin} 检查结果`)
  lines.push('')
  lines.push(`- 检查对象：${report.target}`)
  lines.push(`- 检查时间：${report.checkedAt}`)
  lines.push(`- 规则集版本：${report.rulesetVersion}`)
  lines.push(`- 统计：错误 ${report.summary.error} · 提示 ${report.summary.warn} · 参考 ${report.summary.info}`)
  lines.push('')
  lines.push('## 差异明细')
  lines.push('')
  if (report.issues.length === 0) {
    lines.push('本次执行的检查项未产生差异条目。')
    lines.push('')
  } else {
    lines.push(...issueLines(report.issues))
  }
  lines.push('## 未执行的检查')
  lines.push('')
  if (report.skipped.length === 0) {
    lines.push('规则集声明的全部检查项均已执行。')
  } else {
    lines.push(`以下 ${report.skipped.length} 项检查未执行，其结论不包含在本报告中：`)
    lines.push('')
    for (const entry of report.skipped) lines.push(`- \`${entry.rule}\`：${entry.reason}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(DISCLAIMER)

  return {
    plugin: report.plugin,
    target: report.target,
    checkedAt: report.checkedAt,
    rulesetVersion: report.rulesetVersion,
    summary: report.summary,
    issueCount: report.issues.length,
    skippedCount: report.skipped.length,
    markdown: lines.join('\n'),
    reportJson: canonicalJson(report),
  }
}
