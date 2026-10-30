# dsh-bid-health-check — Bid health check (हिन्दी)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-bid-health-check?metric=downloads)](https://dshfind.com/en/plugins/PerryLink/dsh-bid-health-check?ref=badge)

`dsh-bid-health-check` एक `RequirementsPack` और एक निविदा दस्तावेज़ पढ़कर — आवश्यकता दर आवश्यकता — बताता है कि कहाँ निविदा उत्तर देती दिखती है, कहाँ मेल कमज़ोर है, और कहाँ कुछ भी नहीं मिला।

इस प्रश्न का ईमानदार रूप «क्या निविदा पूर्ण है» से कहीं संकरा है। उपकरण कोई अनुच्छेद ढूँढ सकता है या नहीं ढूँढ सकता; वह नहीं जान सकता कि वह अनुच्छेद आवश्यकता पूरी करता है या नहीं, और यह नहीं कह सकता कि न मिली आवश्यकता का उत्तर नहीं दिया गया।

## Install

```sh
dsh plugin --profile <name> add dsh-bid-health-check
dsh --profile <name> --dump-config | grep 'dsh-bid-health-check'
```

## What it looks like

![Workflow diagram for dsh-bid-health-check: document → rule pack → findings.](docs/assets/dsh-bid-health-check-flow.svg)

*Workflow overview: document → rule pack → findings.*

**सीमा:** तीन वाक्य जो यह उपकरण नहीं कहता। यह नहीं कहता «निविदा पूर्ण है»। यह नहीं कहता «न मिला का अर्थ अनुपस्थित है» — उत्तर तालिका, परिशिष्ट या दूसरे शब्दों में हो सकता है। और यह नहीं कहता «उत्तर मिला का अर्थ अनुरूप है»। यह तालिकाएँ, स्कैन और परिशिष्ट नहीं पढ़ता।

## What it answers

- किन आवश्यकताओं के लिए संभावित उत्तर देने वाला अनुच्छेद मिला?
- कौन-से मेल केवल साझा वाक्यांश हैं?
- किन आवश्यकताओं का कोई उत्तर नहीं मिला?
- कौन-सी आवश्यकताएँ इसलिए जाँची नहीं जा सकीं क्योंकि निविदा दस्तावेज़ ओर ही अनसुलझा है?

## Standards it follows

पैक किसी अनुच्छेद को निष्कर्ष का आधार नहीं बनाता: यह पाठ खोजता है, अनुपालन नहीं जाँचता। दो नियम डिज़ाइन से आते हैं: अस्वीकृति खंड एक शर्त है, उत्तर देने योग्य वाक्य नहीं, इसलिए उसे कभी `responded` नहीं गिना जाता; और C फ़िला वाली आवश्यकता को दस्तावेज़-अवरुद्ध बताया जाता है।

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
