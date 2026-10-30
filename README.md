# dsh-bid-health-check — Bid health check

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

<!-- topblock:v1 -->
> **What it is** — Compares a bid against a requirements list and reports which requirements appear answered, which do not, and which cannot be located.
> **Who it is for** — bid writers.
> **What you give it** — a bid document and a requirements list
> **What it does not do** — no compliance verdict, no liability finding, no replacement for the reviewer; differences only.
> **How to start** — from the command line (not sold separately yet):
> `dsh plugin --profile <name> add dsh-bid-health-check`
<!-- /topblock:v1 -->

[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-bid-health-check?metric=downloads)](https://dshfind.com/en/plugins/PerryLink/dsh-bid-health-check?ref=badge)

`dsh-bid-health-check` reads a `RequirementsPack` (produced by `dsh-tender-requirements`) and a bid document, and reports — requirement by requirement — where the bid appears to answer, where the match is weak, and where nothing could be located.

The honest form of that question is narrower than "is the bid complete". The tool can locate a paragraph that appears to answer a requirement, or fail to locate one. It cannot know whether the located paragraph actually satisfies it, and it certainly cannot conclude that an unlocated requirement is unanswered.

## Install

```sh
dsh plugin --profile <name> add dsh-bid-health-check
dsh --profile <name> --dump-config | grep 'dsh-bid-health-check'
```

## What it looks like

![Workflow diagram for dsh-bid-health-check: document → rule pack → findings.](docs/assets/dsh-bid-health-check-flow.svg)

*Workflow overview: document → rule pack → findings.*

**Boundary:** three sentences this tool does not say. It does not say "the bid is complete"; it says which requirements it could locate text for. It does not say "not located means missing" — the bid may answer in a table, an appendix, or different words. And it does not say "responded means compliant" — that needs a person to read the paragraph. It cannot read tables, scanned pages or attachments, so responses there are not counted at all.

## What it answers

- Which requirements have a bid paragraph that plausibly answers them?
- Which matches are only a shared phrase, and therefore need a person to look?
- Which requirements have no located response, so a human can check them by hand?
- Which requirements cannot be checked at all because the tender side is still unresolved?

## Standards it follows

No clause is cited as the basis of a finding, because this package locates text rather than checks compliance.

Two rules come from the spec's design instead:

- **A rejection clause is a condition, not a sentence.** No bid says 「我方同意被拒收」, so a rejection clause can never be scored `responded` — only `weak`, with a reason explaining that the located paragraph should be reviewed as evidence.
- **Queue C passes through.** A requirement the tender side could not extract reliably is reported as blocked by the pack, not graded against the bidder.

## Compatibility

| Surface | Status |
|---|---|
| Harness | peer range `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | all (pure ESM; no native code, no network, no model call) |

## What it does

For each requirement the tool measures the longest substring it shares with each bid paragraph. Four characters was too loose — 「投标截止时间」 matched on the shared 「投标」 — so a title overlap must reach five characters to count. On a tie the longer paragraph wins, because a heading such as 「第三章 投标保证金」 shares the label with the body that actually states the amount.

An overlap found only in the requirement's *quote* (not its title) is capped at `weak`: sharing text with the clause that contains a requirement is not evidence the requirement is met.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `rules/bid-health-check.yaml` | 规则库路径 |

## Material format

Two inputs:

| Argument | Meaning |
|---|---|
| `pack` | The `RequirementsPack` JSON (or YAML with an `items` array) |
| `file` | The bid document, `.docx` |

Paragraphs come from `dsh-table-ingest`; tables in the bid are not read by this version.

## Rule sources

Quotations live in the pack that this tool consumes, not here.

Known limits, all of them visible in the report: only paragraphs are read, so a response inside a table, a scanned page or an attachment is not counted. Matching is by shared substring, so a paraphrased response is reported as not located. And a located paragraph is a pointer for a human, not a verdict.

## Troubleshooting

- **The plugin installs but the tool never appears**: check that `main` resolves to `lib/index.mjs` and that `pnpm run build` produced it.
- **`dsh plugin add` rejects the package**: the peer range covers `0.1.x` and `0.2.x`; outside it, grant an explicit exemption.
- **A rule did not run**: read the `skipped` array.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
node ../scripts/sync-shared.mjs dsh-bid-health-check
```

## PerryLink DSH Plugin Family

Full family index: [choose a checker by material](https://perrylink.github.io/zh/checkers/choose/) and [all plugins](https://github.com/PerryLink). This repository is one of them.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-bid-health-check contributors.
