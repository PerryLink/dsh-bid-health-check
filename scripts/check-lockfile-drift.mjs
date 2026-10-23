#!/usr/bin/env node
// Fail fast when package.json and pnpm-lock.yaml disagree.
//
// `--frozen-lockfile` makes pnpm refuse to rewrite the lockfile and
// `--lockfile-only` keeps it from touching node_modules, so this is a
// read-only probe: exit 0 means the two files agree, non-zero means someone
// changed one without the other. Without it the first thing that notices is the
// release workflow, with ERR_PNPM_OUTDATED_LOCKFILE.

import { spawnSync } from 'node:child_process'
import process from 'node:process'

const result = spawnSync(
  'pnpm',
  ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)

if (result.status !== 0) {
  console.error('')
  console.error('lockfile drift: package.json and pnpm-lock.yaml disagree.')
  console.error('Fix: `pnpm install --lockfile-only`, then commit the lockfile.')
  process.exit(1)
}

console.log('lockfile ok: package.json and pnpm-lock.yaml agree')
