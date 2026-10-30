# dsh-bid-health-check — Bid health check (Português)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-bid-health-check?metric=downloads)](https://dshfind.com/en/plugins/PerryLink/dsh-bid-health-check?ref=badge)

`dsh-bid-health-check` lê um `RequirementsPack` e um documento de proposta, e reporta — requisito a requisito — onde a proposta parece responder, onde a coincidência é fraca e onde nada foi localizado.

A forma honesta dessa pergunta é mais estreita do que «a proposta está completa?». A ferramenta localiza um parágrafo ou não o localiza; não sabe se esse parágrafo satisfaz o requisito, e não pode concluir que um requisito não localizado esteja sem resposta.

## Install

```sh
dsh plugin --profile <name> add dsh-bid-health-check
dsh --profile <name> --dump-config | grep 'dsh-bid-health-check'
```

## What it looks like

![Workflow diagram for dsh-bid-health-check: document → rule pack → findings.](docs/assets/dsh-bid-health-check-flow.svg)

*Workflow overview: document → rule pack → findings.*

**Limite:** três frases que esta ferramenta não diz. Não diz «a proposta está completa». Não diz «não localizado significa ausente»: a proposta pode responder numa tabela, num anexo ou com outras palavras. E não diz «respondido significa conforme». Não lê tabelas, digitalizações nem anexos.

## What it answers

- Que requisitos têm um parágrafo que plausivelmente os responde?
- Que coincidências são apenas uma frase partilhada?
- Que requisitos não têm resposta localizada?
- Que requisitos não podem ser verificados porque o caderno continua por resolver?

## Standards it follows

O pacote não cita cláusulas como base de um achado: localiza texto, não verifica conformidade. Duas regras vêm do desenho: uma cláusula de rejeição é uma condição, não uma frase a responder, pelo que nunca é pontuada como `responded`; e um requisito em fila C é reportado como bloqueado pelo caderno, não avaliado contra o concorrente.

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

Full family index: [choose a checker by material](https://perrylink.github.io/zh/checkers/choose/) and [all plugins](https://github.com/PerryLink). This repository is one of them.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-bid-health-check contributors.
