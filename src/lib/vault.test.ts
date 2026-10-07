import { describe, expect, it } from 'vitest';
import {
  assertValidVault,
  countWords,
  createNote,
  dailyNoteTitle,
  exportVault,
  extractLinks,
  extractTags,
  getBacklinks,
  getGraphData,
  getTasks,
  importVault,
  MAX_VAULT_BYTES,
  mergeImportedNotes,
  normalizeTitle,
  renameLinks,
  searchNotes,
  resolveNoteLink,
  SEED_NOTES,
  slugify,
  toggleTask,
  validateVault,
  type Note,
  type Vault,
} from './vault';

function note(id: string, title: string, content = '', overrides: Partial<Note> = {}): Note {
  return {
    id,
    title,
    content,
    folder: 'Personal',
    favorite: false,
    trashed: false,
    createdAt: '2026-10-06T12:00:00.000Z',
    updatedAt: '2026-10-06T12:00:00.000Z',
    ...overrides,
  };
}

describe('Markdown knowledge connections', () => {
  it('finds unique tags and wiki targets while ignoring fenced and inline code', () => {
    const markdown =
      '# Encabezado\n#PKM #lectura/activa #PKM #hábitos\n[[Idea|alias]] [[Idea#Sección]] [[Otra nota.md]]\n`#oculta [[Código]]`\n```md\n#interna [[No]]\n```';
    expect(extractTags(markdown)).toEqual(['pkm', 'lectura/activa', 'hábitos']);
    expect(extractLinks(markdown)).toEqual(['Idea', 'Otra nota.md']);
  });

  it('matches backlinks through accents, aliases, headings and relative paths', () => {
    const target = note('target', 'Método Zettelkasten', '', { folder: 'Aprendizaje' });
    const link = note('source', 'Origen', '[[Aprendizaje/Metodo Zettelkasten.md#Notas|mi método]]');
    const self = { ...target, content: '[[Método Zettelkasten]]' };
    const trashed = note('trash', 'Papelera', '[[Método Zettelkasten]]', { trashed: true });
    expect(getBacklinks(target, [self, link, trashed])).toEqual([link]);
  });

  it('builds edges only between existing active notes and removes duplicate edges', () => {
    const notes = [
      note(
        'a',
        'Origen',
        '[[Destino]] [[Destino|alias]] [[Destino#Parte]] [[Ausente]] [[Borrada]]',
      ),
      note('b', 'Destino'),
      note('c', 'Borrada', '', { trashed: true }),
    ];
    expect(getGraphData(notes)).toEqual({
      nodes: [
        { id: 'a', title: 'Origen', folder: 'Personal' },
        { id: 'b', title: 'Destino', folder: 'Personal' },
      ],
      edges: [{ source: 'a', target: 'b' }],
    });
  });

  it('resolves exact folder paths consistently across navigation, graph and backlinks', () => {
    const first = note('first', 'Idea', '', { folder: 'Personal' });
    const second = note('second', 'Idea', '', { folder: 'Proyectos' });
    const trashed = note('trash', 'Papelera', '', { trashed: true });
    const source = note('source', 'Origen', '[[Proyectos/Idea.md#Decisiones|idea]] [[Idea]]');
    const notes = [first, second, trashed, source];
    expect(resolveNoteLink('[[Proyectos/Idea.md#Decisiones|idea]]', notes)).toBe(second);
    expect(resolveNoteLink('Idea#Parte', notes)).toBe(first);
    expect(resolveNoteLink('Desconocida/Idea', notes)).toBeUndefined();
    expect(resolveNoteLink('Papelera', notes)).toBeUndefined();
    expect(resolveNoteLink('#Parte', notes)).toBeUndefined();
    expect(getGraphData(notes).edges).toEqual([
      { source: 'source', target: 'second' },
      { source: 'source', target: 'first' },
    ]);
    expect(getBacklinks(second, notes)).toEqual([source]);
  });

  it('renames links without changing aliases, headings, code or unrelated note objects', () => {
    const original = note(
      'a',
      'Origen',
      '[[Método#Parte|alias]] y [[ Metodo.md | mostrar ]] y [[Aprendizaje/Método#Parte|alias]]\n`[[Método]]`\n```\n[[Método]]\n```',
    );
    const unchanged = note('b', 'Otra', '[[Otra]]');
    const renamed = renameLinks([original, unchanged], 'Método', 'Sistema');
    expect(renamed[0].content).toBe(
      '[[Sistema#Parte|alias]] y [[ Sistema.md | mostrar ]] y [[Aprendizaje/Sistema#Parte|alias]]\n`[[Método]]`\n```\n[[Método]]\n```',
    );
    expect(renamed[1]).toBe(unchanged);
    expect(original.content).toContain('[[Método#Parte|alias]]');
    expect(() => renameLinks([original], 'Método', 'Título|inseguro')).toThrow();
  });
});

describe('search and writing helpers', () => {
  it('combines accent-insensitive text, hierarchy tags, folders and favorite filters', () => {
    const favorite = note('a', 'Método de lectura', 'Ideas para aprender. #hábitos/lectura', {
      folder: 'Aprendizaje/Libros',
      favorite: true,
    });
    const other = note('b', 'Método', '#hábitos', { folder: 'Personal' });
    const trash = note('c', 'Método eliminado', '#hábitos', { trashed: true });
    expect(
      searchNotes([favorite, other, trash], 'metodo tag:habitos folder:Aprendizaje is:favorite'),
    ).toEqual([favorite]);
    expect(searchNotes([favorite, other], '"ideas para" -folder:Personal')).toEqual([favorite]);
    expect(searchNotes([favorite, other, trash], '')).toEqual([favorite, other]);
    expect(searchNotes([favorite, other, trash], 'is:trash')).toEqual([trash]);
  });

  it('creates independent notes with safe folder paths', () => {
    const first = createNote(' Nueva idea ', 'Personal/Ideas', '# Una idea');
    const second = createNote('Nueva idea');
    expect(first.title).toBe('Nueva idea');
    expect(first.content).toBe('# Una idea');
    expect(first.folder).toBe('Personal/Ideas');
    expect(second.folder).toBe('Notas');
    expect(first.id).not.toBe(second.id);
    expect(() => createNote('')).toThrow();
    expect(() => createNote('Idea', '../fuera')).toThrow();
    for (const title of [
      'Idea/otra',
      'Idea|alias',
      'Idea#parte',
      '[Idea]',
      'NUL',
      'Idea.',
      'a'.repeat(241),
      '界'.repeat(81),
    ]) {
      expect(() => createNote(title)).toThrow();
    }
  });

  it('keeps local calendar dates and counts Unicode words without counting link URLs', () => {
    expect(dailyNoteTitle(new Date(2026, 0, 3, 12))).toBe('2026-01-03');
    expect(() => dailyNoteTitle(new Date('invalid'))).toThrow();
    expect(
      countWords('# Hola, jardín. [Leer](https://example.org/long/path) [[Nota|una idea]]'),
    ).toBe(5);
    expect(countWords('')).toBe(0);
    expect(normalizeTitle('  MÉTODO   Práctico ')).toBe('metodo practico');
    expect(slugify('Mi jardín: ideas útiles!')).toBe('mi-jardin-ideas-utiles');
  });
});

describe('task editing', () => {
  it('extracts real tasks with original line numbers, including nested and numbered lists', () => {
    const markdown =
      '# Lista\n- [ ] Primera\n  * [X] Terminada\n1. [ ] Numerada\n```md\n- [ ] Ejemplo\n```';
    expect(
      getTasks([note('a', 'Lista', markdown), note('b', 'Borrada', '- [ ] No', { trashed: true })]),
    ).toEqual([
      { noteId: 'a', noteTitle: 'Lista', line: 1, text: 'Primera', completed: false },
      { noteId: 'a', noteTitle: 'Lista', line: 2, text: 'Terminada', completed: true },
      { noteId: 'a', noteTitle: 'Lista', line: 3, text: 'Numerada', completed: false },
    ]);
  });

  it('toggles only the selected checkbox and preserves CRLF, text and other tasks', () => {
    const markdown = '# Lista\r\n- [ ] Una [[nota]]\r\n- [x] Dos\r\n';
    expect(toggleTask(markdown, 1)).toBe('# Lista\r\n- [x] Una [[nota]]\r\n- [x] Dos\r\n');
    expect(toggleTask(markdown, 2)).toBe('# Lista\r\n- [ ] Una [[nota]]\r\n- [ ] Dos\r\n');
    expect(toggleTask(markdown, 0)).toBe(markdown);
    expect(toggleTask(markdown, -1)).toBe(markdown);
    expect(toggleTask(markdown, 1.5)).toBe(markdown);
  });
});

describe('portable vault backups', () => {
  const valid: Vault = { version: 1, notes: [note('one', 'Una nota', '# Contenido #pkm')] };

  it('round-trips a versioned vault and returns independent validated data', () => {
    const restored = importVault(exportVault(valid));
    expect(restored).toEqual(valid);
    expect(restored.notes[0]).not.toBe(valid.notes[0]);
    expect(importVault(exportVault({ version: 1, notes: SEED_NOTES })).notes).toHaveLength(10);
    expect(getGraphData(SEED_NOTES).edges.length).toBeGreaterThan(20);
    expect(validateVault(valid)).toEqual(valid);
    expect(() => assertValidVault(valid)).not.toThrow();
    expect(() =>
      assertValidVault({ ...valid, notes: [{ ...valid.notes[0], title: 'Un/título' }] }),
    ).toThrow(/título/);
  });

  it.each([
    '../outside',
    '/absolute',
    'C:\\temp',
    'Personal/../../secret',
    'Personal//Ideas',
    'Personal/CON',
    'Personal/name.',
  ])('rejects unsafe folder %s', (folder) => {
    expect(() =>
      importVault(JSON.stringify({ ...valid, notes: [{ ...valid.notes[0], folder }] })),
    ).toThrow(/carpeta/);
  });

  it('rejects corrupt JSON, unsupported versions, duplicate IDs and wrong field types', () => {
    expect(() => importVault('not json')).toThrow(/JSON/);
    expect(() => importVault(JSON.stringify({ ...valid, version: 2 }))).toThrow(/versión/);
    expect(() =>
      importVault(JSON.stringify({ ...valid, notes: [valid.notes[0], valid.notes[0]] })),
    ).toThrow(/duplicado/);
    expect(() =>
      importVault(JSON.stringify({ ...valid, notes: [{ ...valid.notes[0], id: '../bad' }] })),
    ).toThrow(/identificador/);
    expect(() =>
      importVault(JSON.stringify({ ...valid, notes: [{ ...valid.notes[0], favorite: 'true' }] })),
    ).toThrow(/booleanos/);
    expect(() =>
      importVault(
        JSON.stringify({
          ...valid,
          notes: [{ ...valid.notes[0], createdAt: '2026-02-30T12:00:00.000Z' }],
        }),
      ),
    ).toThrow(/fechas/);
  });

  it('enforces the import limit in UTF-8 bytes before parsing', () => {
    const json = JSON.stringify({
      ...valid,
      notes: [{ ...valid.notes[0], content: 'é'.repeat(MAX_VAULT_BYTES / 2) }],
    });
    expect(() => importVault(json)).toThrow(/20 MiB/);
  });
});

describe('merging imported notes', () => {
  it('keeps internal imported links attached to imported notes after title and ID collisions', () => {
    const existing = [note('shared', 'A', 'La nota antigua.')];
    const a = note('shared', 'A', '[[A#Resumen|yo]]', { favorite: true });
    const b = note('b', 'B', '[[A|mi nueva A]] y [[Nota externa]]');
    const merged = mergeImportedNotes(existing, [a, b]);
    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.title)).toEqual(['A (2)', 'B']);
    expect(merged[0].id).not.toBe('shared');
    expect(merged[0].createdAt).toBe(a.createdAt);
    expect(merged[0].updatedAt).toBe(a.updatedAt);
    expect(merged[0].favorite).toBe(true);
    expect(merged[0].content).toBe('[[A (2)#Resumen|yo]]');
    expect(merged[1].content).toBe('[[A (2)|mi nueva A]] y [[Nota externa]]');
    expect(resolveNoteLink(extractLinks(merged[1].content)[0], [...existing, ...merged])?.id).toBe(
      merged[0].id,
    );
    expect(existing[0].content).toBe('La nota antigua.');
    expect(a.title).toBe('A');
    expect(b.content).toBe('[[A|mi nueva A]] y [[Nota externa]]');
  });

  it('preserves full paths, extension case, headings, aliases and literal code', () => {
    const a = note('a', 'Idea', '', { folder: 'Aprendizaje' });
    const b = note('b', 'Idea', '', { folder: 'Proyectos' });
    const source = note(
      'c',
      'Origen',
      '[[ Aprendizaje/Idea.md #Parte| aprendizaje ]] [[Proyectos/Idea.MD#Plan|proyecto]] [[Idea]]\n`[[Idea]]`\n~~~md\n[[Proyectos/Idea]]\n~~~',
    );
    const merged = mergeImportedNotes([note('old', 'Idea')], [a, b, source]);
    expect(merged.map((entry) => entry.title)).toEqual(['Idea (2)', 'Idea (3)', 'Origen']);
    expect(merged[2].content).toBe(
      '[[ Aprendizaje/Idea (2).md #Parte| aprendizaje ]] [[Proyectos/Idea (3).MD#Plan|proyecto]] [[Idea (2)]]\n`[[Idea]]`\n~~~md\n[[Proyectos/Idea]]\n~~~',
    );
    expect(merged[0].folder).toBe('Aprendizaje');
    expect(merged[1].folder).toBe('Proyectos');
    expect(getGraphData(merged).edges).toEqual([
      { source: 'c', target: 'a' },
      { source: 'c', target: 'b' },
    ]);
  });

  it('reserves trashed IDs, allows their titles and handles duplicate IDs inside the batch', () => {
    const existing = [note('same', 'Recuperable', '', { trashed: true })];
    const imported = [note('same', 'Recuperable'), note('same', 'Otra')];
    const merged = mergeImportedNotes(existing, imported);
    expect(merged[0].title).toBe('Recuperable');
    expect(new Set([...existing, ...merged].map((entry) => entry.id)).size).toBe(3);
    expect(() => assertValidVault({ version: 1, notes: [...existing, ...merged] })).not.toThrow();
  });

  it('assigns unique suffixes without exceeding the portable UTF-8 title limit', () => {
    const title = 'é'.repeat(120);
    const existing = [note('old', title)];
    const imported = [note('a', title), note('b', title)];
    const merged = mergeImportedNotes(existing, imported);
    expect(merged[0].title.endsWith(' (2)')).toBe(true);
    expect(merged[1].title.endsWith(' (3)')).toBe(true);
    expect(merged.every((entry) => new TextEncoder().encode(entry.title).byteLength <= 240)).toBe(
      true,
    );
    expect(() => assertValidVault({ version: 1, notes: [...existing, ...merged] })).not.toThrow();
  });
});
