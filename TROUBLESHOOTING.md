# Troubleshooting `dsh-bid-health-check`

## The package is not found or refuses to install

- This checker targets DSH `>=0.2.1-0 <0.3.0` and Node `^22.19.0 || >=24.0.0`.
- Install it through the profile closure: `dsh plugin --profile <name> add dsh-bid-health-check`.
- If npm reports a peer conflict, check the host line first; do not force-install an older DSH core.

## It installs, but I see no findings

- The checker only reports what it can decide from the document you pass to its tool.
- Confirm the tool ran and returned a result; an empty result is not the same as a skipped run.
- Check the document's required columns/fields against the checker's README table. Missing input is usually reported as `skipped`, not as a guessed finding.

## A finding says the clause text was not obtained

- The rule pack follows a citation gate: it never invents clause text.
- When the exact text is unavailable, the finding stays at `warn`/`info` and says so in its `excerpt`.
- Treat that as a verification gap, not as proof that the document is compliant.

## Everything is `warn` or `info`

- By design, this checker does not make a legal, medical, customs, or safety determination.
- It reports differences and gaps; a human owner decides what to do with them.

## Reporting a bug

Open an issue at `https://github.com/PerryLink/dsh-bid-health-check/issues` with:

- the checker version and DSH host version;
- the command or tool call you used;
- a minimal, redacted input and the actual vs expected result.

Never paste credentials, tokens, personal data, or sealed evidence bytes into an issue.
