// An in-memory disk for tests: the `Io` the journal reads and writes through.

import type { Io, IoEntry } from '../lib/journal'

export class MemDisk implements Io {
  readonly files = new Map<string, { text: string; mtimeMs: number }>()
  /** Paths read, in order: tests count these to prove a sync reads only what is new. */
  readonly reads: string[] = []
  readonly writes: string[] = []
  /** Paths whose reads throw while listed here. */
  readonly failing = new Set<string>()
  /** Folders whose listing throws (the folder is there, the disk does not answer properly). */
  readonly listFailing = new Set<string>()
  /** Paths whose calls never come back (a stalled network disk). */
  readonly hanging = new Set<string>()
  private tick = 1000

  private stall(path: string): Promise<never> | null {
    return this.hanging.has(path) ? new Promise<never>(() => {}) : null
  }

  async read(path: string): Promise<string> {
    this.reads.push(path)
    const stalled = this.stall(path)
    if (stalled !== null) return stalled
    if (this.failing.has(path)) throw new Error(`EIO: cannot read ${path}\nsecond line`)
    const f = this.files.get(path)
    if (f === undefined) throw new Error(`ENOENT: ${path}`)
    return f.text
  }

  async write(path: string, text: string): Promise<void> {
    this.writes.push(path)
    const stalled = this.stall(path)
    if (stalled !== null) return stalled
    this.put(path, text)
  }

  /** A file, or a folder with something in it. */
  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true
    const prefix = `${path.replace(/\/+$/, '')}/`
    for (const key of this.files.keys()) if (key.startsWith(prefix)) return true
    return false
  }

  async list(dir: string): Promise<IoEntry[]> {
    const stalled = this.stall(dir)
    if (stalled !== null) return stalled
    if (this.listFailing.has(dir)) throw new Error(`EIO: cannot list ${dir}`)
    const prefix = `${dir.replace(/\/+$/, '')}/`
    const out: IoEntry[] = []
    const dirs = new Set<string>()
    let any = false
    for (const [path, f] of this.files) {
      if (!path.startsWith(prefix)) continue
      any = true
      const rest = path.slice(prefix.length)
      if (!rest.includes('/')) out.push({ name: rest, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs })
      else {
        const name = rest.slice(0, rest.indexOf('/'))
        if (!dirs.has(name)) {
          dirs.add(name)
          out.push({ name, kind: 'dir', size: 0, mtimeMs: f.mtimeMs })
        }
      }
    }
    if (!any) throw new Error(`ENOENT: ${dir}`)
    return out
  }

  /** A file appearing from outside the code under test (another session, git pull, a hand edit). */
  put(path: string, text: string): void {
    this.tick += 1
    this.files.set(path, { text, mtimeMs: this.tick })
  }

  remove(path: string): void {
    this.files.delete(path)
  }

  text(path: string): string {
    const f = this.files.get(path)
    if (f === undefined) throw new Error(`no such file in the test disk: ${path}`)
    return f.text
  }
}
