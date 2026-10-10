// Where a project's decisions live (spec 5.1). Nothing here touches the engine:
// the caller passes in what it can ask the machine.

export type ProjectIo = {
  exists: (path: string) => Promise<boolean>
  /** `git rev-parse --show-toplevel` in `cwd`; null when there is no repository. */
  gitTop: (cwd: string) => Promise<string | null>
}

const SEP = /[\\/]/

/** The folder above `path`, or null at a root. */
export function parentDir(path: string): string | null {
  const trimmed = path.length > 1 ? path.replace(/[\\/]+$/, '') : path
  if (trimmed === '' || trimmed === '/' || /^[A-Za-z]:$/.test(trimmed)) return null
  let cut = -1
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (SEP.test(trimmed[i]!)) {
      cut = i
      break
    }
  }
  if (cut < 0) return null
  if (cut === 0) return '/'
  const parent = trimmed.slice(0, cut)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}${trimmed[cut]}` : parent
}

export function joinPath(dir: string, ...rest: string[]): string {
  let out = dir.replace(/[\\/]+$/, '')
  for (const part of rest) out += `/${part.replace(/^[\\/]+/, '')}`
  return out === '' ? '/' : out
}

/**
 * The project root, in this order:
 *  1. the first folder from `cwd` upwards that holds `.claude/decisions/config.json`
 *     (so a session started in a sub-folder joins the same record);
 *  2. the git top-level folder;
 *  3. `cwd` itself.
 */
export async function findRoot(io: ProjectIo, cwd: string): Promise<string> {
  let dir: string | null = cwd
  for (let hops = 0; dir !== null && hops < 64; hops++) {
    let found = false
    try {
      found = await io.exists(joinPath(dir, '.claude', 'decisions', 'config.json'))
    } catch {
      found = false
    }
    if (found) return dir
    dir = parentDir(dir)
  }
  try {
    const top = await io.gitTop(cwd)
    if (top !== null && top !== '') return top
  } catch {
    // no git, or git refused: the working folder is the project
  }
  return cwd
}

/** The last folder name of a path: the default title of a project. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(SEP).filter(p => p !== '')
  return parts.length > 0 ? parts[parts.length - 1]! : 'project'
}

/** `path` relative to `root` when it lies under it, else `path` as given. */
export function relativeTo(root: string, path: string): string {
  const r = root.replace(/[\\/]+$/, '')
  return path.startsWith(`${r}/`) ? path.slice(r.length + 1) : path
}

/** `file` made absolute against `root` (an absolute path stays as it is). */
export function resolveFrom(root: string, file: string): string {
  if (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return file
  return joinPath(root, file)
}
