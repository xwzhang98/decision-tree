// The engine's file and process calls, shaped for the libraries below them.

import type { Io, IoEntry } from './journal'
import type { Port } from './port'
import type { ProjectIo } from './project'

/** The engine as the libraries see it (named `$` where they use it). */
export type Dollar = Port

/** Files through `$.fs`: what the journal reads and writes. */
export function engineIo($: Dollar): Io {
  return {
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    exists: path => $.fs.exists(path),
    list: async path => {
      const entries = await $.fs.list(path)
      return entries.map(
        (e): IoEntry => ({
          name: e.name,
          kind: e.kind === 'file' ? 'file' : e.kind === 'dir' ? 'dir' : 'other',
          size: e.size,
          mtimeMs: e.mtimeMs,
        }),
      )
    },
  }
}

/** What finding the project root needs: whether a file exists, and git's top-level folder. */
export function projectIo($: Dollar): ProjectIo {
  return {
    exists: path => $.fs.exists(path),
    gitTop: async cwd => {
      try {
        const out = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 5000 })
        if (out.exitCode !== 0) return null
        const top = out.stdout.trim()
        return top === '' ? null : top
      } catch {
        return null
      }
    },
  }
}

/** True when git says `.claude/decisions/` would be ignored (so the record would not reach git). */
export async function isIgnoredByGit($: Dollar, root: string): Promise<boolean> {
  try {
    const out = await $.process.run(['git', 'check-ignore', '-q', '--', '.claude/decisions/config.json'], { cwd: root, timeoutMs: 5000 })
    return out.exitCode === 0
  } catch {
    return false
  }
}
