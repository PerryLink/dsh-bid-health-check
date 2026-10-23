/**
 * Wording guard for the report rendering layer.
 *
 * Every plugin in this family produces prompts, checklists, cross-checks and
 * drafts. None of them produces a professional conclusion, so the rendered
 * report must not contain adjudicating language. This module is the single
 * place that defines the forbidden lexicon and the mandatory disclaimer.
 */

/**
 * Adjudicating phrases that must never appear in a rendered report.
 * Kept as a list of literals so the guard is greppable and reviewable.
 */
export const FORBIDDEN_WORDING: readonly string[] = [
  '合规',
  '不合规',
  '违规',
  '违法',
  '不合格',
  '合格证',
  '通过验收',
  '审查通过',
  '审核通过',
  '构成违法',
  '构成犯罪',
  '构成虚开',
  '虚开',
  '已合规',
  '依法追究',
  '无效合同',
  '合同无效',
]

/**
 * Phrases that are allowed even though they contain a forbidden substring.
 * Checked before {@link FORBIDDEN_WORDING} so a benign, factual use of the
 * same characters does not raise a false alarm.
 */
export const ALLOWED_PHRASES: readonly string[] = [
  '未通过',
  '不通过',
  '可通过',
  '未构成',
  '不构成',
  '合格判定准则',
]

/**
 * Quoted spans are never the plugin's own assertion.
 *
 * A rule may now quote a clause verbatim, and a quoted document title may contain a forbidden
 * substring — 《机动车维修竣工出厂合格证》 is the real name of the certificate required by
 * 《机动车维修管理规定》第三十二条. Stripping quoted spans before the scan keeps the guard aimed at
 * wording the REPORT asserts, while leaving verbatim quotations lawful. Document titles are written
 * with 《》 and quotations with 「」, so both are stripped.
 */
const QUOTED_SPAN = /《[^》]*》|「[^」]*」/g

/** Footer appended to every rendered report. */
export const DISCLAIMER =
  '免责声明：本报告由程序按声明的规则集自动生成，仅列出与所引条款之间的字面差异，供人工复核线索使用；' +
  '不构成对任何事实、行为或文件的定性意见，也不替代主管人员、评审专家或监管机构的判断。' +
  '规则集的时效性与适用范围以引用文件的最新有效版本为准。'

/** True when `text` contains a forbidden phrase outside the allow-list and outside quotations. */
export function findForbiddenWording(text: string): string[] {
  let scrubbed = text.replace(QUOTED_SPAN, '\u0000')
  for (const allowed of ALLOWED_PHRASES) scrubbed = scrubbed.split(allowed).join('\u0000')
  const hits: string[] = []
  for (const phrase of FORBIDDEN_WORDING) {
    if (scrubbed.includes(phrase)) hits.push(phrase)
  }
  return hits
}
