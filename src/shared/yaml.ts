/**
 * Minimal, dependency-free YAML reader for rule packs and check material.
 *
 * Rule packs are authored by hand and shipped inside each plugin, so the
 * supported surface is deliberately small and strictly block-structured:
 *
 * ```yaml
 * version: "2026.1"
 * rules:
 *   - id: R-001
 *     severity: error
 *     basis:
 *       document: 《病历书写基本规范》
 *       clause: 第二十二条（八）
 *     params:
 *       maxHours: 6
 *     note: >-
 *       Folded scalars join their lines with single spaces.
 * ```
 *
 * Supported: nested block mappings, block sequences, `- key: value` items,
 * plain / single- / double-quoted scalars, the empty collections `[]` and `{}`,
 * literal `|` and folded `>` block scalars, `#` comments and blank lines.
 *
 * Rejected loudly rather than guessed: flow collections, anchors, aliases, tags
 * and multi-document streams.
 */

/** Raised when a document uses syntax outside the supported subset. */
export class YamlSubsetError extends Error {
  constructor(message: string, line?: number) {
    super(line === undefined ? message : `${message} (line ${line})`)
    this.name = 'YamlSubsetError'
  }
}

interface Line {
  indent: number
  text: string
  num: number
}

function stripComment(raw: string, lineNum: number): string {
  let quote: string | null = null
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index] as string
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (index === 0 || /\s/.test(raw[index - 1] as string))) return raw.slice(0, index)
  }
  if (quote !== null) throw new YamlSubsetError('unterminated quoted scalar', lineNum)
  return raw
}

function unescapeDouble(body: string, lineNum: number): string {
  let out = ''
  for (let index = 0; index < body.length; index++) {
    const char = body[index] as string
    if (char !== '\\') {
      out += char
      continue
    }
    const next = body[index + 1]
    if (next === undefined) throw new YamlSubsetError('dangling escape in double-quoted scalar', lineNum)
    index += 1
    switch (next) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case '"': out += '"'; break
      case '\\': out += '\\'; break
      case '0': out += '\u0000'; break
      default: throw new YamlSubsetError(`unsupported escape "\\${next}"`, lineNum)
    }
  }
  return out
}

/** Index of the `:` separating key from value, or -1 when the text is a scalar. */
function findKeySeparator(text: string): number {
  let quote: string | null = null
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ':' && (index + 1 === text.length || /\s/.test(text[index + 1] as string))) return index
  }
  return -1
}

function isSequenceItem(text: string): boolean {
  return text === '-' || text.startsWith('- ')
}

function parseScalar(raw: string, lineNum: number): unknown {
  const text = raw.trim()
  if (text === '') return null
  if (text.startsWith('[') || text.startsWith('{')) return parseFlow(text, lineNum)
  if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) {
    throw new YamlSubsetError('anchors, aliases and tags are not supported by this reader', lineNum)
  }
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) throw new YamlSubsetError('bad double-quoted scalar', lineNum)
    return unescapeDouble(text.slice(1, -1), lineNum)
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw new YamlSubsetError('bad single-quoted scalar', lineNum)
    return text.slice(1, -1).replace(/''/g, "'")
  }
  if (text === 'null' || text === '~') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^[+-]?\d+$/.test(text)) return Number.parseInt(text, 10)
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number.parseFloat(text)
  return text
}

/**
 * Parse a flow collection (`[a, b]` or `{k: v}`), including nesting.
 *
 * Hand-written packs use flow style for short lists — a rule's `aliases`, for
 * example — so supporting it keeps those packs readable. Only the JSON-compatible
 * subset is accepted: no anchors, no tags, no multi-line flow.
 */
function parseFlow(text: string, lineNum: number): unknown {
  let index = 0

  const skipSpace = (): void => {
    while (index < text.length && /\s/.test(text[index] as string)) index += 1
  }

  const readToken = (stopAtColon: boolean): unknown => {
    skipSpace()
    const char = text[index]
    if (char === undefined) throw new YamlSubsetError('unexpected end of flow collection', lineNum)
    if (char === '[' || char === '{') return readCollection()
    if (char === '"' || char === "'") {
      const quote = char
      let body = ''
      index += 1
      while (index < text.length) {
        const current = text[index] as string
        if (quote === '"' && current === '\\') {
          body += current + (text[index + 1] ?? '')
          index += 2
          continue
        }
        if (current === quote) {
          if (quote === "'" && text[index + 1] === "'") {
            body += "'"
            index += 2
            continue
          }
          index += 1
          return quote === '"' ? unescapeDouble(body, lineNum) : body
        }
        body += current
        index += 1
      }
      throw new YamlSubsetError('unterminated quoted scalar in flow collection', lineNum)
    }
    // Plain scalar: everything up to a structural character.
    let plain = ''
    while (index < text.length) {
      const current = text[index] as string
      if (current === ',' || current === ']' || current === '}') break
      if (stopAtColon && current === ':') break
      plain += current
      index += 1
    }
    return parseScalar(plain, lineNum)
  }

  const readCollection = (): unknown => {
    const open = text[index] as string
    const close = open === '[' ? ']' : '}'
    index += 1
    if (open === '[') {
      const items: unknown[] = []
      skipSpace()
      if (text[index] === close) {
        index += 1
        return items
      }
      for (;;) {
        items.push(readToken(false))
        skipSpace()
        const separator = text[index]
        if (separator === ',') {
          index += 1
          continue
        }
        if (separator === close) {
          index += 1
          return items
        }
        throw new YamlSubsetError(`expected "," or "${close}" in flow sequence`, lineNum)
      }
    }
    const out: Record<string, unknown> = {}
    skipSpace()
    if (text[index] === close) {
      index += 1
      return out
    }
    for (;;) {
      const key = readToken(true)
      skipSpace()
      if (text[index] !== ':') throw new YamlSubsetError('expected ":" in flow mapping', lineNum)
      index += 1
      const value = readToken(false)
      out[String(key)] = value
      skipSpace()
      const separator = text[index]
      if (separator === ',') {
        index += 1
        continue
      }
      if (separator === close) {
        index += 1
        return out
      }
      throw new YamlSubsetError(`expected "," or "${close}" in flow mapping`, lineNum)
    }
  }

  const value = readCollection()
  skipSpace()
  if (index !== text.length) {
    throw new YamlSubsetError(`trailing characters after flow collection: "${text.slice(index)}"`, lineNum)
  }
  return value
}

/**
 * Recursive-descent reader over pre-tokenized content lines.
 *
 * The single invariant: every `parse*` method consumes only lines whose indent
 * is at least the indent it was given for that collection, and stops at the
 * first line that is shallower. A child may be indented by any amount deeper
 * than its parent entry, because hand-written packs do not agree on a step.
 */
class Reader {
  private index = 0

  /** Content lines, in document order. */
  private readonly lines: readonly Line[]

  constructor(lines: readonly Line[]) {
    this.lines = lines
  }

  /** Current line, or undefined at end of document. */
  peek(): Line | undefined {
    return this.lines[this.index]
  }

  /** Consume and return the current line. */
  take(): Line {
    const line = this.lines[this.index]
    if (line === undefined) throw new YamlSubsetError('unexpected end of document')
    this.index += 1
    return line
  }

  /** Body of a `|` or `>` block scalar, stopping at the first line at or above `parentIndent`. */
  readBlockScalar(parentIndent: number, kind: '|' | '>', startLine: number): string {
    const collected: string[] = []
    let blockIndent: number | null = null
    while (true) {
      const next = this.peek()
      if (next === undefined || next.indent <= parentIndent) break
      this.index += 1
      if (blockIndent === null) blockIndent = next.indent
      collected.push(' '.repeat(Math.max(0, next.indent - blockIndent)) + next.text)
    }
    if (blockIndent === null) throw new YamlSubsetError('empty block scalar', startLine)
    if (kind === '|') return collected.join('\n')
    return collected
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .join(' ')
  }

  /**
   * Read the value of `key:` whose scalar part was empty.
   * @param keyIndent - column of the key, so a shallower sibling ends the value.
   */
  readNested(keyIndent: number): unknown {
    const next = this.peek()
    if (next === undefined || next.indent <= keyIndent) return null
    return this.readCollection(next.indent)
  }

  /**
   * Read a mapping or sequence starting at the current line.
   * @param indent - column at which the collection's entries must start.
   */
  readCollection(indent: number): unknown {
    const line = this.peek()
    if (line === undefined || line.indent < indent) return null
    return isSequenceItem(line.text) ? this.readSequence(line.indent) : this.readMapping(line.indent)
  }

  /**
   * Read a block mapping whose entries sit at `indent`.
   * @param indent - column the mapping entries occupy.
   * @param seed - first entry that shares a `- ` line and was already consumed.
   */
  readMapping(indent: number, seed?: { text: string; line: number }): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    let pending = seed
    for (;;) {
      if (pending === undefined) {
        const line = this.peek()
        if (line === undefined || line.indent < indent) break
        if (line.indent > indent) throw new YamlSubsetError('unexpected indentation in block mapping', line.num)
        if (isSequenceItem(line.text)) break
        this.index += 1
        pending = { text: line.text, line: line.num }
      }
      const separator = findKeySeparator(pending.text)
      if (separator < 0) throw new YamlSubsetError(`expected "key: value", got "${pending.text}"`, pending.line)
      const key = pending.text.slice(0, separator).trim()
      if (key === '') throw new YamlSubsetError('empty mapping key', pending.line)
      if (Object.hasOwn(out, key)) throw new YamlSubsetError(`duplicate mapping key "${key}"`, pending.line)
      out[key] = this.readEntryValue(pending.text.slice(separator + 1).trim(), indent, pending.line)
      pending = undefined
    }
    return out
  }

  /** Value that follows `key:` on the same line, or the nested collection below it. */
  private readEntryValue(rawValue: string, keyIndent: number, lineNum: number): unknown {
    if (rawValue === '|' || rawValue === '|-' || rawValue === '>' || rawValue === '>-') {
      return this.readBlockScalar(keyIndent, rawValue.startsWith('|') ? '|' : '>', lineNum)
    }
    if (rawValue !== '') return parseScalar(rawValue, lineNum)
    return this.readNested(keyIndent)
  }

  /**
   * Read a block sequence whose dashes sit at `indent`. A `- key: value` line
   * opens a mapping whose first entry shares the dash line; the remaining entries
   * follow at the key column, which is two past the dash.
   */
  readSequence(indent: number): unknown[] {
    const items: unknown[] = []
    for (;;) {
      const line = this.peek()
      if (line === undefined || line.indent < indent) break
      if (line.indent > indent) throw new YamlSubsetError('unexpected indentation in block sequence', line.num)
      if (!isSequenceItem(line.text)) break
      this.index += 1
      const rest = line.text === '-' ? '' : line.text.slice(2).trim()
      // A flow collection as a sequence item (`- {a: 1}`) is one scalar, not the
      // start of a block mapping: its first `:` belongs to the flow map. Checking
      // the separator first turned `- {field: x, op: exists}` into a mapping whose
      // key was the literal text `{field`, and every condition silently lost its
      // fields.
      if (rest.startsWith('{') || rest.startsWith('[')) {
        items.push(parseScalar(rest, line.num))
        continue
      }
      const separator = rest === '' ? -1 : findKeySeparator(rest)
      if (separator >= 0) {
        items.push(this.readMapping(indent + 2, { text: rest, line: line.num }))
        continue
      }
      items.push(rest === '' ? this.readNested(indent) : parseScalar(rest, line.num))
    }
    return items
  }
}

/**
 * Turn raw YAML text into content lines, dropping comments and blank lines.
 *
 * Inside a `|` or `>` block scalar nothing is YAML syntax any more — quotes,
 * hashes and colons are content — so the reader tracks the block's indentation
 * and passes those lines through verbatim. Without this, a procurement clause
 * quoted inside a rule's `note` would be read as an unterminated string.
 */
function tokenize(source: string): Line[] {
  const rawLines = source.split(/\r?\n/)
  const lines: Line[] = []
  let blockIndent: number | null = null
  let blockParentIndent = -1
  for (let index = 0; index < rawLines.length; index++) {
    const num = index + 1
    const raw = rawLines[index] as string
    const expanded = raw.replace(/\t/g, '  ')
    const indent = expanded.length - expanded.trimStart().length
    const body = expanded.trim()

    if (blockIndent !== null) {
      // Blank lines stay inside the block; a shallower line ends it.
      if (body === '') continue
      if (indent <= blockParentIndent) {
        blockIndent = null
      } else {
        lines.push({ indent, text: body, num })
        continue
      }
    }

    const withoutComment = stripComment(raw, num)
    if (withoutComment.trim() === '') continue
    const text = withoutComment.replace(/\t/g, '  ').trim()
    const effectiveIndent = withoutComment.replace(/\t/g, '  ').length - withoutComment.replace(/\t/g, '  ').trimStart().length
    lines.push({ indent: effectiveIndent, text, num })
    if (/:\s*[|>][+-]?\s*$/.test(text)) {
      blockIndent = effectiveIndent + 1
      blockParentIndent = effectiveIndent
    }
  }
  return lines
}

/**
 * Parse one block-structured YAML document.
 * @param source - YAML text.
 * @returns the parsed value; an empty document yields `null`.
 */
export function parseYaml(source: string): unknown {
  const lines = tokenize(source)
  if (lines.length === 0) return null
  const reader = new Reader(lines)
  const value = reader.readCollection((lines[0] as Line).indent)
  const leftover = reader.peek()
  if (leftover !== undefined) throw new YamlSubsetError('trailing content after document', leftover.num)
  return value
}

/** Read a required string field, failing loudly when absent. */
export function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new YamlSubsetError(`${where}: missing required string field "${key}"`)
  }
  return value
}

/** Read a required number field, failing loudly when absent or not numeric. */
export function requireNumber(source: Record<string, unknown>, key: string, where: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new YamlSubsetError(`${where}: missing required numeric field "${key}"`)
  }
  return value
}
