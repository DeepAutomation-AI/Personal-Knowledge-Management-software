import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createNote } from './vault';
import { exportMarkdownZip, importFiles, importMarkdownFiles, IMPORT_LIMITS } from './files';

async function zipFile(zip: JSZip): Promise<File> {
  return new File(
    [await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })],
    'notes.zip',
  );
}

describe('portable Markdown files', () => {
  it('imports UTF-8 Markdown with its relative folders and keeps content unchanged', async () => {
    const file = new File(['# Mi conocimiento\n\n[Enlace](https://example.com)'], 'mi-nota.md');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Bóveda/Proyectos/mi-nota.md' });
    const [note] = await importMarkdownFiles([file]);
    expect(note.title).toBe('mi-nota');
    expect(note.folder).toBe('Bóveda/Proyectos');
    expect(note.content).toBe(await file.text());
    expect(note.favorite).toBe(false);
    expect(note.trashed).toBe(false);
  });

  it('imports .markdown and .txt notes and rejects unsupported top-level files', async () => {
    const notes = await importFiles([
      new File(['one'], 'One.markdown'),
      new File(['two'], 'Two.TXT'),
    ]);
    expect(notes.map((note) => note.content)).toEqual(['one', 'two']);
    await expect(importFiles([new File(['binary'], 'photo.png')])).rejects.toThrow(
      'no es Markdown',
    );
  });

  it('rejects unsafe relative paths and empty folder segments', async () => {
    for (const path of [
      '../secret.md',
      '/absolute.md',
      'C:\\secret.md',
      'Notes//secret.md',
      'Notes/../secret.md',
    ]) {
      const file = new File(['test'], 'secret.md');
      Object.defineProperty(file, 'webkitRelativePath', { value: path });
      await expect(importFiles([file])).rejects.toThrow('ruta no válida o insegura');
    }
  });

  it('enforces per-file, combined byte, count and UTF-8 limits', async () => {
    const oversized = new File(['small'], 'large.md');
    Object.defineProperty(oversized, 'size', { value: IMPORT_LIMITS.fileBytes + 1 });
    await expect(importFiles([oversized])).rejects.toThrow('5 MB');
    const countOverflow = Array.from({ length: 501 }, (_, index) => new File(['a'], `${index}.md`));
    await expect(importFiles(countOverflow)).rejects.toThrow('500 archivos');
    const bytes = new Uint8Array(IMPORT_LIMITS.fileBytes);
    const largeFiles = Array.from({ length: 5 }, (_, index) => new File([bytes], `${index}.md`));
    await expect(importFiles(largeFiles)).rejects.toThrow('20 MB');
    await expect(importFiles([new File([new Uint8Array([0xff])], 'invalid.md')])).rejects.toThrow(
      'UTF-8',
    );
  });
});

describe('Markdown ZIP archives', () => {
  it('round-trips titles, folders, content, dates and flags with fresh IDs', async () => {
    const first = createNote(
      'Memoria e imaginación',
      'Biblioteca/Psicología',
      '# Memoria\n\n[[Ideas]]',
    );
    first.favorite = true;
    const second = createNote(first.title, first.folder, 'Contenido de una nota diferente');
    second.trashed = true;
    const exported = await exportMarkdownZip([first, second]);
    const archive = await JSZip.loadAsync(await exported.arrayBuffer());
    const paths = Object.keys(archive.files).filter((path) => /\.md$/.test(path));
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe('Biblioteca/Psicología/Memoria e imaginación.md');
    expect(paths[1]).toContain(second.id);
    expect(await archive.file(paths[0])!.async('string')).toBe(first.content);
    const imported = await importFiles([new File([exported], 'atlas.zip')]);
    expect(imported).toHaveLength(2);
    for (const [index, note] of imported.entries()) {
      const original = [first, second][index];
      expect(note.id).not.toBe(original.id);
      expect({ ...note, id: original.id }).toEqual(original);
    }
  });

  it('imports a standard ZIP without Atlas metadata, ignoring non-text assets', async () => {
    const archive = new JSZip();
    archive.file('Research/brain.md', '# Brain\n\nA standard note');
    archive.file('Research/image.png', new Uint8Array([137, 80, 78, 71]));
    const [note] = await importFiles([await zipFile(archive)]);
    expect(note.folder).toBe('Research');
    expect(note.title).toBe('brain');
  });

  it('detects traversal in the original ZIP name before JSZip sanitization', async () => {
    const archive = new JSZip();
    archive.file('../outside.md', 'escaped note');
    await expect(importFiles([await zipFile(archive)])).rejects.toThrow(
      'ruta no válida o insegura',
    );
  });

  it('checks inflated bytes rather than trusting the compressed archive size', async () => {
    const archive = new JSZip();
    archive.file('compressed.md', 'a'.repeat(IMPORT_LIMITS.fileBytes + 1));
    const compressed = await zipFile(archive);
    expect(compressed.size).toBeLessThan(100_000);
    await expect(importFiles([compressed])).rejects.toThrow('5 MB');
  });

  it('rejects broken ZIP files and manifest references outside the archive', async () => {
    await expect(importFiles([new File(['not a ZIP'], 'broken.zip')])).rejects.toThrow(
      'No se pudo abrir el ZIP',
    );
    const note = createNote('Safe', 'Notes', 'text');
    const archive = new JSZip();
    archive.file('Notes/safe.md', note.content);
    archive.file(
      'atlas-manifest.json',
      JSON.stringify({ version: 1, notes: [{ ...note, path: 'Other/missing.md' }] }),
    );
    await expect(importFiles([await zipFile(archive)])).rejects.toThrow('inexistente o duplicada');
  });

  it('rejects exporting unsafe folders instead of generating a traversal archive', async () => {
    const note = { ...createNote('Title', 'Notes', 'text'), folder: '../private' };
    await expect(exportMarkdownZip([note])).rejects.toThrow(/carpeta|ruta/);
  });
});
