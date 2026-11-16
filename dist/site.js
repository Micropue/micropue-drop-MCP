import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DropMcpError, inputError } from './errors.js';
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
export const MAX_PATH_LENGTH = 120;
export const MAX_FOLDER_LENGTH = 100;
export const MAX_FOLDERS = 50;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const FILE_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}\.(html|css|js)$/u;
const PATH_SEGMENT_RE = /^[\p{L}\p{N}._-]+$/u;
export function normalizeSlug(raw) {
    const slug = raw.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
        throw inputError('slug 必须是 1–40 位小写字母、数字或连字符，且不能以连字符开头或结尾。', '例如：my-site、demo-2026。');
    }
    return slug;
}
function validateProjectPath(raw, index) {
    const value = raw.trim();
    if (!value)
        throw inputError(`files[${index}].path 不能为空。`);
    if (value.length > MAX_PATH_LENGTH) {
        throw inputError(`files[${index}].path 超过 ${MAX_PATH_LENGTH} 个字符。`);
    }
    if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
        throw inputError(`文件路径不合法：${value}`);
    }
    const parts = value.split('/');
    const invalid = parts.some(part => (!part ||
        part === '.' ||
        part === '..' ||
        !PATH_SEGMENT_RE.test(part)));
    if (invalid)
        throw inputError(`文件路径包含非法目录段：${value}`);
    const baseName = parts[parts.length - 1] ?? '';
    if (!FILE_RE.test(baseName)) {
        throw inputError(`文件 ${value} 不被 DROP 支持。`, 'DROP 只接受 .html、.css 和 .js；文件名需以小写扩展名结尾。');
    }
    return value;
}
function deriveFolders(files) {
    const folders = new Set();
    for (const file of files) {
        const parts = file.path.split('/');
        parts.pop();
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (current.length > MAX_FOLDER_LENGTH) {
                throw inputError(`目录路径超过 ${MAX_FOLDER_LENGTH} 个字符：${current}`);
            }
            folders.add(current);
        }
    }
    if (folders.size > MAX_FOLDERS) {
        throw inputError(`项目最多允许 ${MAX_FOLDERS} 个目录。`);
    }
    return [...folders].sort((a, b) => a.localeCompare(b));
}
export function createSiteSnapshot(files, ignored = []) {
    if (files.length < 1 || files.length > MAX_FILES) {
        throw inputError(`一个站点必须包含 1–${MAX_FILES} 个文件。`);
    }
    const seen = new Set();
    const normalized = [];
    let totalBytes = 0;
    for (const [index, file] of files.entries()) {
        const projectPath = validateProjectPath(file.path, index);
        const key = projectPath.toLowerCase();
        if (seen.has(key))
            throw inputError(`存在重复文件路径：${projectPath}`);
        seen.add(key);
        if (typeof file.content !== 'string') {
            throw inputError(`文件 ${projectPath} 的内容必须是字符串。`);
        }
        const bytes = Buffer.byteLength(file.content, 'utf8');
        if (bytes > MAX_FILE_BYTES) {
            throw inputError(`文件 ${projectPath} 大小为 ${bytes} 字节，超过 512 KiB。`);
        }
        totalBytes += bytes;
        normalized.push({ path: projectPath, content: file.content });
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
        throw inputError(`站点总大小为 ${totalBytes} 字节，超过 1 MiB。`);
    }
    normalized.sort((a, b) => a.path.localeCompare(b.path));
    return {
        files: normalized,
        folders: deriveFolders(normalized),
        totalBytes,
        ignored
    };
}
function isWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative));
}
async function canonicalFileSystemPath(value) {
    try {
        return await realpath(value);
    }
    catch {
        throw inputError(`路径不存在或无法访问：${value}`);
    }
}
export async function loadDirectorySnapshot(options) {
    if (options.allowedRoots.length === 0) {
        throw new DropMcpError('invalid_config', 'DROP_ALLOWED_ROOTS 至少需要一个允许目录。');
    }
    const requestedPath = path.resolve(options.cwd, options.sourcePath);
    const sourceRoot = await canonicalFileSystemPath(requestedPath);
    const roots = await Promise.all(options.allowedRoots.map(root => canonicalFileSystemPath(path.resolve(options.cwd, root))));
    if (!roots.some(root => isWithin(root, sourceRoot))) {
        throw inputError(`拒绝读取 ${requestedPath}：它不在 DROP_ALLOWED_ROOTS 允许的目录内。`, `允许目录：${options.allowedRoots.join(', ')}`);
    }
    const sourceStat = await stat(sourceRoot);
    if (!sourceStat.isDirectory()) {
        throw inputError(`发布路径必须是目录：${requestedPath}`);
    }
    const collected = [];
    const unsupported = [];
    const ignored = [];
    const seen = new Set();
    const walk = async (directory, relativeDir) => {
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules')
                continue;
            const relativePath = relativeDir
                ? `${relativeDir}/${entry.name}`
                : entry.name;
            const absolutePath = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                throw inputError(`出于安全原因，不支持发布目录中的符号链接：${relativePath}`);
            }
            if (entry.isDirectory()) {
                await walk(absolutePath, relativePath);
                continue;
            }
            if (!entry.isFile())
                continue;
            if (!FILE_RE.test(entry.name)) {
                if (options.ignoreUnsupported) {
                    ignored.push(relativePath);
                    continue;
                }
                unsupported.push(relativePath);
                continue;
            }
            const canonicalPath = await realpath(absolutePath);
            if (!isWithin(sourceRoot, canonicalPath)) {
                throw inputError(`拒绝读取目录外文件：${relativePath}`);
            }
            const fileStat = await stat(canonicalPath);
            if (!fileStat.isFile())
                continue;
            if (fileStat.size > MAX_FILE_BYTES) {
                throw inputError(`文件 ${relativePath} 超过 512 KiB。`);
            }
            const buffer = await readFile(canonicalPath);
            let content;
            try {
                content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            }
            catch {
                throw inputError(`文件 ${relativePath} 不是有效的 UTF-8 文本。`);
            }
            const key = relativePath.toLowerCase();
            if (seen.has(key))
                throw inputError(`存在大小写不同的重复文件路径：${relativePath}`);
            seen.add(key);
            collected.push({ path: relativePath, content });
            if (collected.length > MAX_FILES) {
                throw inputError(`站点文件数超过 DROP 的 ${MAX_FILES} 个上限。`);
            }
        }
    };
    await walk(sourceRoot, '');
    if (unsupported.length > 0) {
        const preview = unsupported.slice(0, 8).join(', ');
        const suffix = unsupported.length > 8 ? ` 等 ${unsupported.length} 个文件` : '';
        throw inputError(`目录中包含 DROP 不支持的文件：${preview}${suffix}`, '请只指向构建后的静态目录，或设置 ignoreUnsupported=true 明确跳过不支持的文件。');
    }
    return createSiteSnapshot(collected, ignored);
}
//# sourceMappingURL=site.js.map