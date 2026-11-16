import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  createSiteSnapshot,
  loadDirectorySnapshot
} from '../src/site.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'drop-mcp-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
  )
})

describe('createSiteSnapshot', () => {
  it('normalizes file order and derives every parent folder', () => {
    const snapshot = createSiteSnapshot([
      { path: 'assets/site.css', content: 'body{}' },
      { path: 'index.html', content: '<h1>Hello</h1>' },
      { path: 'assets/js/app.js', content: 'console.log("hello")' }
    ])

    expect(snapshot.files.map(file => file.path)).toEqual([
      'assets/js/app.js',
      'assets/site.css',
      'index.html'
    ])
    expect(snapshot.folders).toEqual(['assets', 'assets/js'])
    expect(snapshot.totalBytes).toBe(
      Buffer.byteLength('body{}') +
      Buffer.byteLength('<h1>Hello</h1>') +
      Buffer.byteLength('console.log("hello")')
    )
    expect(snapshot.ignored).toEqual([])
  })

  it('rejects unsupported files, traversal, and case-insensitive duplicates', () => {
    expect(() => createSiteSnapshot([{ path: 'README.md', content: 'hello' }]))
      .toThrow(/不被 DROP 支持/)
    expect(() => createSiteSnapshot([{ path: '../outside.html', content: 'hello' }]))
      .toThrow(/非法目录段/)
    expect(() => createSiteSnapshot([
      { path: 'index.html', content: 'one' },
      { path: 'INDEX.html', content: 'two' }
    ])).toThrow(/重复文件路径/)
  })

  it('enforces file count and byte limits', () => {
    const tooMany = Array.from({ length: MAX_FILES + 1 }, (_, index) => ({
      path: `page-${index}.html`,
      content: 'x'
    }))
    expect(() => createSiteSnapshot(tooMany)).toThrow(new RegExp(`1–${MAX_FILES}`))

    expect(() => createSiteSnapshot([
      { path: 'large.html', content: 'x'.repeat(MAX_FILE_BYTES + 1) }
    ])).toThrow(/超过 512 KiB/)

    expect(() => createSiteSnapshot([
      { path: 'one.html', content: 'x'.repeat(400 * 1024) },
      { path: 'two.html', content: 'x'.repeat(400 * 1024) },
      { path: 'three.html', content: 'x'.repeat(400 * 1024) }
    ])).toThrow(/超过 1 MiB/)
  })
})

describe('loadDirectorySnapshot', () => {
  it('reads a build directory while skipping hidden paths and node_modules', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'dist', 'assets'), { recursive: true })
    await mkdir(path.join(root, 'dist', 'node_modules', 'ignored'), { recursive: true })
    await writeFile(path.join(root, 'dist', 'index.html'), '<h1>Hello</h1>')
    await writeFile(path.join(root, 'dist', 'assets', 'site.css'), 'body{}')
    await writeFile(path.join(root, 'dist', '.DS_Store'), 'ignored')
    await writeFile(path.join(root, 'dist', 'node_modules', 'ignored', 'index.js'), 'ignored')

    const snapshot = await loadDirectorySnapshot({
      sourcePath: 'dist',
      allowedRoots: [root],
      cwd: root
    })

    expect(snapshot.files.map(file => file.path)).toEqual([
      'assets/site.css',
      'index.html'
    ])
    expect(snapshot.folders).toEqual(['assets'])
  })

  it('rejects paths outside the configured roots', async () => {
    const base = await temporaryDirectory()
    const allowed = path.join(base, 'allowed')
    const outside = path.join(base, 'outside')
    await mkdir(allowed)
    await mkdir(outside)
    await writeFile(path.join(outside, 'index.html'), '<h1>Outside</h1>')

    await expect(loadDirectorySnapshot({
      sourcePath: outside,
      allowedRoots: [allowed],
      cwd: base
    })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rejects symbolic links even when their target is inside the root', async () => {
    const root = await temporaryDirectory()
    await writeFile(path.join(root, 'real.html'), '<h1>Real</h1>')
    await symlink(path.join(root, 'real.html'), path.join(root, 'linked.html'))

    await expect(loadDirectorySnapshot({
      sourcePath: root,
      allowedRoots: [root],
      cwd: root
    })).rejects.toThrow(/符号链接/)
  })

  it('fails on unsupported files unless they are explicitly ignored', async () => {
    const root = await temporaryDirectory()
    await writeFile(path.join(root, 'index.html'), '<h1>Hello</h1>')
    await writeFile(path.join(root, 'notes.txt'), 'notes')

    await expect(loadDirectorySnapshot({
      sourcePath: root,
      allowedRoots: [root],
      cwd: root
    })).rejects.toThrow(/不支持的文件/)

    const snapshot = await loadDirectorySnapshot({
      sourcePath: root,
      allowedRoots: [root],
      cwd: root,
      ignoreUnsupported: true
    })
    expect(snapshot.files.map(file => file.path)).toEqual(['index.html'])
    expect(snapshot.ignored).toEqual(['notes.txt'])
  })

  it('rejects non-UTF-8 files', async () => {
    const root = await temporaryDirectory()
    await writeFile(path.join(root, 'index.html'), Buffer.from([0xff, 0xfe, 0xfd]))

    await expect(loadDirectorySnapshot({
      sourcePath: root,
      allowedRoots: [root],
      cwd: root
    })).rejects.toThrow(/UTF-8/)
  })
})
