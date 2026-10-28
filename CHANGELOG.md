# Changelog

## 0.1.1

- Require `dsh-table-ingest` `^0.2.1`, which adds the ZIP entry-count, per-entry and cumulative output budgets requested in the dshopen review. No rule or report change.

## 0.1.0

First release: consume a `RequirementsPack` and report, per requirement, where the
bid appears to answer it.

- Three states — `responded`, `weak`, `not-located` — and the third is not "missing".
  A bid may answer in a table, an appendix, or different words; the report says so in
  as many words, because presenting "not located" as "missing" is how a bidder comes
  to rewrite a section that was already there.
- **A rejection clause can never be scored `responded`.** It is a condition the
  bidder must meet, not a sentence to answer — no bid says 「我方同意被拒收」. Locating
  related text is still useful, so it caps at `weak` with the reason.
- Queue C passes through: a requirement the tender side could not extract reliably is
  reported as blocked by the pack, not graded against the bidder.
- Matching is by longest shared substring, not a term list. A term list scored the
  clause 「…未按照招标文件要求密封的…应当拒收」 as answered by a paragraph about
  sealing, because they share the phrase 招标文件要求密封. Four characters was also
  too loose (「投标截止时间」 matched on 「投标」), so a title overlap must reach five.
  On a tie the longer paragraph wins: a heading repeats the label, the body states the
  fact.
- Reading an empty pack is refused rather than grading every bid against nothing.
- 18 tests.
