# dsh-bid-health-check — 投标响应健康度核对

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

<!-- topblock:v1 -->
> **这是什么**　把一份投标文件和一份要求清单对起来，告诉你哪些要求有响应、哪些没有、哪些根本定位不到。
> **给谁用**　投标专员、投标文件编制人。
> **你交什么**　一份投标文件与一份要求清单；报告哪些要求有响应、哪些没有。
> **它不做什么**　不判合规、不认定责任、不替代审核人；只列材料内部能逐条指认的差异。
> **怎么开始**　命令行安装（暂未单独上架）：
> `dsh plugin --profile <name> add dsh-bid-health-check`
<!-- /topblock:v1 -->

[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-bid-health-check?metric=downloads)](https://dshfind.com/en/plugins/PerryLink/dsh-bid-health-check?ref=badge)

`dsh-bid-health-check` 读一份 `RequirementsPack`（由 `dsh-tender-requirements` 生成）和一份投标文件，逐条报告：哪里看起来有响应、哪里匹配很弱、哪里完全定位不到。

**这个问题的诚实形态比「投标文件完整吗」窄得多。** 工具能定位到一段看起来在回应要求的文字，或者定位不到。它不能判断那一段是否真的满足要求，更不能断言定位不到就等于没写。

## Install

```sh
dsh plugin --profile <name> add dsh-bid-health-check
dsh --profile <name> --dump-config | grep 'dsh-bid-health-check'
```

## What it looks like

![Workflow diagram for dsh-bid-health-check: document → rule pack → findings.](docs/assets/dsh-bid-health-check-flow.svg)

*Workflow overview: document → rule pack → findings.*

**边界：** 三句它不说的话。它不说「投标文件是完整的」，只说哪些要求找到了对应文字。它不说「定位不到等于没写」—— 可能写在表格、附件里，或换了说法。它也不说「有响应等于满足要求」—— 那要人去看那一段。它读不了表格、扫描件与附件，这些地方的响应完全不计入。

## What it answers

- 哪些要求有一段看起来在回应的文字？
- 哪些匹配只是共享了一个短语，需要人去看？
- 哪些要求完全定位不到，需要人工核对？
- 哪些要求因为采购文件侧还没解决，根本没法核对？

## Standards it follows

本包不引用条款作为判定依据 —— 它做的是文字定位，不是合规检查。

两条规则来自规格的设计：

- **废标条款是条件，不是句子。** 没有投标文件会写「我方同意被拒收」，所以废标条款永远不会被评成 `responded`，最多 `weak`，并说明找到的那一段应当作为证据来看。
- **C 队列透传。** 采购文件侧就抽不出来的要求，报为「被采购文件阻塞」，不拿它去评投标人。

## Compatibility

| Surface | Status |
|---|---|
| Harness | peer range `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | all (pure ESM; no native code, no network, no model call) |

## What it does

For each requirement the tool measures the longest substring shared with each bid paragraph. A title overlap must reach five characters; a tie goes to the longer paragraph, because a heading repeats the label while the body states the fact. An overlap found only in the requirement quote is capped at weak.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `rules/bid-health-check.yaml` | 规则库路径 |

## Material format

Two inputs: `pack` (the RequirementsPack JSON, or YAML with an items array) and `file` (the bid .docx). Paragraphs come from `dsh-table-ingest`.

## Rule sources

Quotations live in the pack this tool consumes. Known limits, all visible in the report: only paragraphs are read; matching is by shared substring, so a paraphrased response is reported as not located; and a located paragraph is a pointer for a human, not a verdict.

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

完整清单（62 个核查器 + 通用插件）见 [按材料选核查器](https://perrylink.github.io/zh/checkers/choose/)；本仓只是其中一个。

## License

[Apache License 2.0](LICENSE) © 2026 dsh-bid-health-check contributors.
