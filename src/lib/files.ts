import type { default as JSZip, JSZipObject } from 'jszip';
import { assertValidVault, createNote, type Note } from './vault';

export const IMPORT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  files: 500,
} as const;

const MANIFEST_NAME = 'atlas-manifest.json';
const TEXT_EXTENSION = /\.(md|markdown|txt)$/i;

interface ManifestNote {
  path: string;
  title: string;
  folder: string;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  trashed: boolean;
}

interface ImportBudget {
  files: number;
  bytes: number;
}

// JSZip documents this browser streaming API, but its bundled types omit it.
interface ZipEntryStream {
  on(event: 'data', callback: (chunk: Uint8Array) => void): ZipEntryStream;
  on(event: 'error', callback: (error: Error) => void): ZipEntryStream;
  on(event: 'end', callback: () => void): ZipEntryStream;
  pause(): ZipEntryStream;
  resume(): ZipEntryStream;
}

type StreamingZipObject = JSZipObject & {
  internalStream(type: 'uint8array'): ZipEntryStream;
};

export class ImportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImportError';
  }
}

function safePath(path: string, directory = false): string {
  const normalized = path.normalize('NFC').replace(/\\/g, '/');
  const candidate = directory && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const parts = candidate.split('/');
  if (
    !candidate ||
    candidate.length > 1024 ||
    parts.length > 32 ||
    parts.some(
      (part) =>
        !part.trim() ||
        part !== part.trim() ||
        new TextEncoder().encode(part).byteLength > 255 ||
        part === '.' ||
        part === '..' ||
        part.endsWith('.') ||
        /[\u0000-\u001f\u007f:*?"<>|]/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw new ImportError('El archivo contiene una ruta no válida o insegura.');
  }
  return candidate;
}

function filenameSlug(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const result = slug.slice(0, 120) || 'sin-titulo';
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(result) ? `nota-${result}` : result;
}

function portableFilename(title: string): string {
  if (/[\\/]/.test(title)) return filenameSlug(title);
  try {
    safePath(`${title}.md`);
    return title;
  } catch {
    return filenameSlug(title);
  }
}

function assertSize(bytes: number, budget: ImportBudget): void {
  if (bytes > IMPORT_LIMITS.fileBytes)
    throw new ImportError('Cada nota puede ocupar como máximo 5 MB.');
  if (budget.bytes + bytes > IMPORT_LIMITS.totalBytes) {
    throw new ImportError('La importación puede ocupar como máximo 20 MB descomprimidos.');
  }
}

function countFile(budget: ImportBudget): void {
  budget.files += 1;
  if (budget.files > IMPORT_LIMITS.files) {
    throw new ImportError('Puedes importar como máximo 500 archivos a la vez.');
  }
}

async function fileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new ImportError(`No se pudo leer «${file.name}».`));
    reader.readAsArrayBuffer(file);
  });
}

function decodeText(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ImportError(`«${path}» no es un archivo de texto UTF-8 válido.`, { cause: error });
  }
}

/** Read ZIP entries in bounded chunks rather than allocating an unchecked inflated file. */
function readZipEntry(entry: JSZipObject, budget: ImportBudget): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let length = 0;
    let failed = false;
    const chunks: Uint8Array[] = [];
    const stream = (entry as StreamingZipObject).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      if (failed) return;
      try {
        length += chunk.length;
        assertSize(length, budget);
        chunks.push(chunk);
      } catch (error) {
        failed = true;
        stream.pause();
        reject(error);
      }
    });
    stream.on('error', (error: Error) => {
      if (failed) return;
      failed = true;
      reject(new ImportError(`No se pudo descomprimir «${entry.name}».`, { cause: error }));
    });
    stream.on('end', () => {
      if (failed) return;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      budget.bytes += length;
      resolve(bytes);
    });
    stream.resume();
  });
}

function noteFromFile(path: string, content: string, metadata?: ManifestNote): Note {
  const pieces = path.split('/');
  const filename = pieces.pop()!;
  const folder = pieces.length ? pieces.join('/') : 'Importadas';
  const title = filename.replace(TEXT_EXTENSION, '').trim() || 'Sin título';
  const note = createNote(metadata?.title ?? title, metadata?.folder ?? folder, content);
  if (metadata) {
    note.createdAt = metadata.createdAt;
    note.updatedAt = metadata.updatedAt;
    note.favorite = metadata.favorite;
    note.trashed = metadata.trashed;
  }
  assertValidVault({ version: 1, notes: [note] });
  return note;
}

function readManifest(content: string, entries: Set<string>): Map<string, ManifestNote> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new ImportError('El manifiesto del ZIP no contiene JSON válido.', { cause: error });
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== 1 ||
    !('notes' in value) ||
    !Array.isArray(value.notes) ||
    value.notes.length > IMPORT_LIMITS.files
  ) {
    throw new ImportError('El manifiesto del ZIP no es válido.');
  }
  const metadata = new Map<string, ManifestNote>();
  for (const item of value.notes) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.path !== 'string' ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      typeof item.folder !== 'string' ||
      typeof item.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      typeof item.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.updatedAt)) ||
      typeof item.favorite !== 'boolean' ||
      typeof item.trashed !== 'boolean'
    ) {
      throw new ImportError('El manifiesto del ZIP contiene metadatos no válidos.');
    }
    const path = safePath(item.path);
    if (item.folder) safePath(item.folder);
    if (!entries.has(path) || !TEXT_EXTENSION.test(path) || metadata.has(path)) {
      throw new ImportError(
        'El manifiesto del ZIP hace referencia a una nota inexistente o duplicada.',
      );
    }
    metadata.set(path, item as ManifestNote);
  }
  return metadata;
}

async function importZip(file: File, budget: ImportBudget): Promise<Note[]> {
  if (file.size > IMPORT_LIMITS.totalBytes)
    throw new ImportError('El archivo ZIP puede ocupar como máximo 20 MB.');
  let archive: JSZip;
  try {
    const { default: JSZip } = await import('jszip');
    archive = await JSZip.loadAsync(await fileBytes(file));
  } catch (error) {
    throw new ImportError(
      'No se pudo abrir el ZIP. Comprueba que sea un archivo válido y sin contraseña.',
      { cause: error },
    );
  }
  const entries = new Map<string, JSZipObject>();
  for (const entry of Object.values(archive.files)) {
    const original =
      'unsafeOriginalName' in entry && typeof entry.unsafeOriginalName === 'string'
        ? entry.unsafeOriginalName
        : entry.name;
    const path = safePath(original, entry.dir);
    if (entry.dir) continue;
    if (entries.has(path)) throw new ImportError('El ZIP contiene rutas de archivo duplicadas.');
    entries.set(path, entry);
    if (path !== MANIFEST_NAME) countFile(budget);
  }
  const manifestEntry = entries.get(MANIFEST_NAME);
  const metadata = manifestEntry
    ? readManifest(
        decodeText(await readZipEntry(manifestEntry, budget), MANIFEST_NAME),
        new Set(entries.keys()),
      )
    : new Map<string, ManifestNote>();
  const notes: Note[] = [];
  for (const [path, entry] of entries) {
    if (!TEXT_EXTENSION.test(path)) continue;
    const content = decodeText(await readZipEntry(entry, budget), path);
    notes.push(noteFromFile(path, content, metadata.get(path)));
  }
  return notes;
}

/** Import is all-or-nothing: callers receive notes only after every selected file validates. */
export async function importFiles(files: File[]): Promise<Note[]> {
  if (!files.length) return [];
  if (files.length > IMPORT_LIMITS.files)
    throw new ImportError('Puedes importar como máximo 500 archivos a la vez.');
  const budget: ImportBudget = { files: 0, bytes: 0 };
  const notes: Note[] = [];
  for (const file of files) {
    const path = safePath(file.webkitRelativePath || file.name);
    if (/\.zip$/i.test(path)) {
      notes.push(...(await importZip(file, budget)));
      continue;
    }
    if (!TEXT_EXTENSION.test(path))
      throw new ImportError(`«${file.name}» no es Markdown, texto ni ZIP.`);
    countFile(budget);
    assertSize(file.size, budget);
    const bytes = await fileBytes(file);
    assertSize(bytes.length, budget);
    budget.bytes += bytes.length;
    notes.push(noteFromFile(path, decodeText(bytes, path)));
  }
  if (!notes.length)
    throw new ImportError('No se encontraron notas Markdown ni archivos de texto para importar.');
  return notes;
}

export async function importMarkdownFiles(files: File[]): Promise<Note[]> {
  if (files.some((file) => !TEXT_EXTENSION.test(file.name))) {
    throw new ImportError('Selecciona archivos .md, .markdown o .txt.');
  }
  return importFiles(files);
}

/** Keep portable titles as filenames so ordinary Obsidian wikilinks resolve unchanged. */
export async function exportMarkdownZip(notes: Note[]): Promise<Blob> {
  assertValidVault({ version: 1, notes });
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const paths = new Set<string>();
  const manifest: ManifestNote[] = [];
  for (const note of notes) {
    const folder = note.folder ? `${safePath(note.folder)}/` : '';
    const filename = portableFilename(note.title);
    let path = `${folder}${filename}.md`;
    if (paths.has(path.toLocaleLowerCase('es'))) {
      const suffix = filenameSlug(note.id);
      let basename = filename;
      while (new TextEncoder().encode(basename).byteLength > 240 - suffix.length) {
        basename = Array.from(basename).slice(0, -1).join('');
      }
      path = `${folder}${basename}-${suffix}.md`;
      let collision = 2;
      while (paths.has(path.toLocaleLowerCase('es'))) {
        path = `${folder}${basename}-${suffix}-${collision++}.md`;
      }
    }
    safePath(path);
    paths.add(path.toLocaleLowerCase('es'));
    zip.file(path, note.content);
    manifest.push({
      path,
      title: note.title,
      folder: note.folder,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      favorite: note.favorite,
      trashed: note.trashed,
    });
  }
  zip.file(MANIFEST_NAME, JSON.stringify({ version: 1, notes: manifest }, null, 2));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
}
