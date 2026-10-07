export interface Note {
  id: string;
  title: string;
  content: string;
  folder: string;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  trashed: boolean;
}

export interface Vault {
  version: 1;
  notes: Note[];
}

export interface NoteTask {
  noteId: string;
  noteTitle: string;
  /** Zero-based line number in the original Markdown document. */
  line: number;
  text: string;
  completed: boolean;
}

export interface GraphData {
  nodes: { id: string; title: string; folder: string }[];
  edges: { source: string; target: string }[];
}

export const MAX_VAULT_BYTES = 20 * 1024 * 1024;

/** Accent-insensitive matching without changing the user's stored text. */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es');
}

export function slugify(value: string): string {
  return (
    normalizeTitle(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'nota'
  );
}

function isSafeFolder(folder: string): boolean {
  if (folder === '') return true;
  if (folder.length > 1024 || /[\\\u0000-\u001f\u007f<>:"|?*]/u.test(folder)) return false;
  return folder
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 &&
        segment.length <= 255 &&
        new TextEncoder().encode(segment).byteLength <= 255 &&
        segment !== '.' &&
        segment !== '..' &&
        segment === segment.trim() &&
        !segment.endsWith('.') &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
    );
}

function isValidTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 240 &&
    new TextEncoder().encode(trimmed).byteLength <= 240 &&
    !/[\\/\u0000-\u001f\u007f<>:"|?*\[\]#]/u.test(trimmed) &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.endsWith('.') &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed)
  );
}

export function createNote(title: string, folder = 'Notas', content = ''): Note {
  if (title.trim().length > 240 || new TextEncoder().encode(title.trim()).byteLength > 240)
    throw new Error(
      'El título es demasiado largo para exportarlo a Markdown. Usa un título más corto.',
    );
  if (!isValidTitle(title))
    throw new Error('Usa un título no vacío, sin [] # ni caracteres reservados: <>:"/\\|?*.');
  if (!isSafeFolder(folder))
    throw new Error('La carpeta debe ser una ruta relativa válida y segura.');
  const now = new Date().toISOString();
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    title: title.trim(),
    content,
    folder,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    trashed: false,
  };
}

/** Preserve fenced and inline code verbatim while visiting actual Markdown text. */
function mapOutsideCode(content: string, transform: (text: string) => string): string {
  let fence: { character: string; length: number } | undefined;
  return content
    .split(/(\r?\n)/)
    .map((line, index) => {
      if (index % 2 === 1) return line;
      const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (
          boundary &&
          boundary[1][0] === fence.character &&
          boundary[1].length >= fence.length &&
          !boundary[2].trim()
        )
          fence = undefined;
        return line;
      }
      if (boundary) {
        fence = { character: boundary[1][0], length: boundary[1].length };
        return line;
      }
      const code = /(`+)(.*?)\1/g;
      let result = '';
      let offset = 0;
      for (const match of line.matchAll(code)) {
        result += transform(line.slice(offset, match.index)) + match[0];
        offset = match.index! + match[0].length;
      }
      return result + transform(line.slice(offset));
    })
    .join('');
}

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  mapOutsideCode(content, (text) => {
    for (const match of text.matchAll(/(?:^|[\s([{])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)) {
      tags.add(match[1].toLocaleLowerCase('es').replace(/\/+$/g, ''));
    }
    return text;
  });
  return [...tags];
}

export function extractLinks(content: string): string[] {
  const links = new Set<string>();
  mapOutsideCode(content, (text) => {
    for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const title = match[1].split('|', 1)[0].split('#', 1)[0].trim();
      if (title) links.add(title);
    }
    return text;
  });
  return [...links];
}

function linkKey(title: string): string {
  return normalizeTitle(title).replace(/\.md$/i, '');
}

function createLinkResolver(notes: Note[]): (link: string) => Note | undefined {
  const titles = new Map<string, Note>();
  const paths = new Map<string, Note>();
  for (const note of notes) {
    if (note.trashed) continue;
    const title = linkKey(note.title);
    if (!titles.has(title)) titles.set(title, note);
    const path = linkKey(note.folder ? `${note.folder}/${note.title}` : note.title);
    if (!paths.has(path)) paths.set(path, note);
  }
  return (link) => {
    const inner = link.trim().replace(/^!?\[\[([\s\S]*)\]\]$/, '$1');
    const key = linkKey(inner.split('|', 1)[0].split('#', 1)[0]);
    if (!key) return undefined;
    return key.includes('/') ? paths.get(key) : titles.get(key);
  };
}

/** Resolve an active note by title or exact folder/title, ignoring .md, aliases and headings. */
export function resolveNoteLink(link: string, notes: Note[]): Note | undefined {
  return createLinkResolver(notes)(link);
}

export function getBacklinks(note: Note, notes: Note[]): Note[] {
  const resolve = createLinkResolver(notes);
  return notes.filter(
    (candidate) =>
      !candidate.trashed &&
      candidate.id !== note.id &&
      extractLinks(candidate.content).some((link) => resolve(link)?.id === note.id),
  );
}

/** Text terms combine with AND; quoted terms, tag:, folder:, is:favorite and exclusions are supported. */
export function searchNotes(notes: Note[], query: string): Note[] {
  const tokens = (query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((token) =>
    token.replace(/"/g, ''),
  );
  const includeTrash = tokens.some((token) => /^is:(?:trash|trashed)$/i.test(token));
  return notes.filter((note) => {
    if (note.trashed && !includeTrash) return false;
    const text = normalizeTitle(`${note.title}\n${note.content}\n${note.folder}`);
    return tokens.every((original) => {
      const negative = original.startsWith('-') && original.length > 1;
      const token = negative ? original.slice(1) : original;
      const normalized = normalizeTitle(token);
      let matches: boolean;
      if (normalized.startsWith('tag:')) {
        const tag = normalized.slice(4).replace(/^#/, '');
        matches =
          tag.length > 0 &&
          extractTags(note.content).some((item) => {
            const value = normalizeTitle(item);
            return value === tag || value.startsWith(`${tag}/`);
          });
      } else if (normalized.startsWith('folder:')) {
        const folder = normalized.slice(7).replace(/\/+$/g, '');
        const actual = normalizeTitle(note.folder);
        matches = actual === folder || (folder.length > 0 && actual.startsWith(`${folder}/`));
      } else if (normalized === 'is:favorite') {
        matches = note.favorite;
      } else if (normalized === 'is:trash' || normalized === 'is:trashed') {
        matches = note.trashed;
      } else {
        matches = text.includes(normalized);
      }
      return negative ? !matches : matches;
    });
  });
}

export function getGraphData(notes: Note[]): GraphData {
  const active = notes.filter((note) => !note.trashed);
  const resolve = createLinkResolver(active);
  const edges: GraphData['edges'] = [];
  const seen = new Set<string>();
  for (const note of active) {
    for (const link of extractLinks(note.content)) {
      const target = resolve(link);
      if (!target) continue;
      const key = `${note.id}\u0000${target.id}`;
      if (!seen.has(key)) {
        edges.push({ source: note.id, target: target.id });
        seen.add(key);
      }
    }
  }
  return { nodes: active.map(({ id, title, folder }) => ({ id, title, folder })), edges };
}

export function countWords(content: string): number {
  const readable = content
    .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) =>
      target.includes('|') ? target.split('|').slice(1).join('|') : target,
    )
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '');
  return readable.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function dailyNoteTitle(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error('La fecha no es válida.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return false;
  return Number.isFinite(Date.parse(value));
}

function assertNote(entry: unknown, index: number, ids: Set<string>): asserts entry is Note {
  const error: (reason: string) => never = (reason) => {
    throw new Error(`Nota ${index + 1}: ${reason}`);
  };
  if (!isRecord(entry)) error('el registro no es válido.');
  if (typeof entry.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(entry.id))
    error('el identificador no es válido.');
  if (ids.has(entry.id)) error('el identificador está duplicado.');
  ids.add(entry.id);
  if (typeof entry.title !== 'string' || !isValidTitle(entry.title))
    error('el título no es válido o no es portátil.');
  if (typeof entry.content !== 'string') error('el contenido debe ser texto.');
  if (typeof entry.folder !== 'string' || !isSafeFolder(entry.folder))
    error('la carpeta no es una ruta relativa segura.');
  if (!isTimestamp(entry.createdAt) || !isTimestamp(entry.updatedAt))
    error('las fechas no son válidas.');
  if (typeof entry.favorite !== 'boolean' || typeof entry.trashed !== 'boolean')
    error('los estados de favorito y papelera deben ser booleanos.');
}

/** Structural validation for live storage, with no JSON serialization or content-sized allocation. */
export function assertValidVault(value: unknown): asserts value is Vault {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.notes))
    throw new Error(
      'Formato de bóveda no compatible. Se requiere la versión 1 y una lista de notas.',
    );
  if (value.notes.length > 20000) throw new Error('La bóveda supera el límite de 20 000 notas.');
  const ids = new Set<string>();
  value.notes.forEach((entry: unknown, index: number) => assertNote(entry, index, ids));
}

export function validateVault(value: unknown): Vault {
  assertValidVault(value);
  return {
    version: 1,
    notes: value.notes.map((entry) => ({
      id: entry.id,
      title: entry.title.trim(),
      content: entry.content,
      folder: entry.folder,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      favorite: entry.favorite,
      trashed: entry.trashed,
    })),
  };
}

export function importVault(json: string): Vault {
  if (typeof json !== 'string') throw new Error('La bóveda debe ser un archivo JSON de texto.');
  if (json.length > MAX_VAULT_BYTES || new TextEncoder().encode(json).byteLength > MAX_VAULT_BYTES)
    throw new Error('La bóveda supera el límite de 20 MiB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }
  return validateVault(parsed);
}

export function exportVault(vault: Vault): string {
  const json = JSON.stringify(vault, null, 2);
  importVault(json);
  return json;
}

export function getTasks(notes: Note[]): NoteTask[] {
  const tasks: NoteTask[] = [];
  for (const note of notes) {
    if (note.trashed) continue;
    let line = 0;
    let fence: { character: string; length: number } | undefined;
    for (const text of note.content.split(/\r?\n/)) {
      const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
      if (fence) {
        if (
          boundary &&
          boundary[1][0] === fence.character &&
          boundary[1].length >= fence.length &&
          !boundary[2].trim()
        )
          fence = undefined;
      } else if (boundary) {
        fence = { character: boundary[1][0], length: boundary[1].length };
      } else {
        const match = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/.exec(text);
        if (match)
          tasks.push({
            noteId: note.id,
            noteTitle: note.title,
            line,
            text: match[2].trim(),
            completed: match[1].toLowerCase() === 'x',
          });
      }
      line += 1;
    }
  }
  return tasks;
}

export function toggleTask(content: string, line: number): string {
  if (!Number.isInteger(line) || line < 0) return content;
  const parts = content.split(/(\r?\n)/);
  const index = line * 2;
  if (index >= parts.length) return content;
  parts[index] = parts[index].replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/,
    (_, prefix: string, state: string, suffix: string) =>
      `${prefix}${state === ' ' ? 'x' : ' '}${suffix}`,
  );
  return parts.join('');
}

export function renameLinks(notes: Note[], oldTitle: string, newTitle: string): Note[] {
  if (!isValidTitle(newTitle) || /[\[\]#|\r\n]/.test(newTitle))
    throw new Error('El nuevo título no puede contener delimitadores de enlaces.');
  const oldKey = linkKey(oldTitle);
  const timestamp = new Date().toISOString();
  return notes.map((note) => {
    const content = mapOutsideCode(note.content, (text) =>
      text.replace(/\[\[([^\]\n]+)\]\]/g, (original: string, inner: string) => {
        const pipe = inner.indexOf('|');
        const target = pipe >= 0 ? inner.slice(0, pipe) : inner;
        const alias = pipe >= 0 ? inner.slice(pipe) : '';
        const hash = target.indexOf('#');
        const title = hash >= 0 ? target.slice(0, hash) : target;
        const heading = hash >= 0 ? target.slice(hash) : '';
        const leading = title.match(/^\s*/)?.[0] ?? '';
        const trailing = title.match(/\s*$/)?.[0] ?? '';
        const trimmed = title.trim();
        const slash = trimmed.lastIndexOf('/');
        const basename = trimmed.slice(slash + 1);
        const fullMatch = linkKey(title) === oldKey;
        if (!fullMatch && (oldTitle.includes('/') || linkKey(basename) !== oldKey)) return original;
        const path = !fullMatch && slash >= 0 ? trimmed.slice(0, slash + 1) : '';
        const extension = /\.md$/i.test(trimmed) ? '.md' : '';
        return `[[${leading}${path}${newTitle.trim()}${extension}${trailing}${heading}${alias}]]`;
      }),
    );
    return content === note.content ? note : { ...note, content, updatedAt: timestamp };
  });
}

function titleWithSuffix(title: string, suffix: string): string {
  const characters = Array.from(title);
  while (new TextEncoder().encode(characters.join('') + suffix).byteLength > 240) characters.pop();
  return (characters.join('') + suffix).trim();
}

/**
 * Adapt an imported batch without redirecting its internal links to pre-existing notes.
 * Only the adapted imported notes are returned; the caller chooses when to persist them.
 */
export function mergeImportedNotes(existing: Note[], imported: Note[]): Note[] {
  assertValidVault({ version: 1, notes: existing });
  if (existing.length + imported.length > 20000)
    throw new Error('La bóveda supera el límite de 20 000 notas.');
  const titles = new Set(
    existing.filter((note) => !note.trashed).map((note) => normalizeTitle(note.title)),
  );
  const ids = new Set(existing.map((note) => note.id));
  const replacements = new Map<Note, Note>();
  const adapted = imported.map((original, index): Note => {
    // Duplicate IDs are allowed at this boundary and receive a fresh identity below.
    assertNote(original, index, new Set());
    let title = original.title.trim();
    let counter = 2;
    while (titles.has(normalizeTitle(title)))
      title = titleWithSuffix(original.title.trim(), ` (${counter++})`);
    titles.add(normalizeTitle(title));
    let id = original.id;
    if (ids.has(id)) {
      const base = createNote(title, original.folder).id;
      id = base;
      let counter = 2;
      while (ids.has(id)) id = `${base}-${counter++}`;
    }
    ids.add(id);
    const note = { ...original, id, title };
    if (!replacements.has(original)) replacements.set(original, note);
    return note;
  });
  const resolve = createLinkResolver(imported);
  return adapted.map((note) => ({
    ...note,
    content: mapOutsideCode(note.content, (text) =>
      text.replace(/\[\[([^\]\n]+)\]\]/g, (original: string, inner: string) => {
        const target = resolve(inner);
        const replacement = target && replacements.get(target);
        if (!target || !replacement || replacement.title === target.title) return original;
        const pipe = inner.indexOf('|');
        const destination = pipe >= 0 ? inner.slice(0, pipe) : inner;
        const alias = pipe >= 0 ? inner.slice(pipe) : '';
        const hash = destination.indexOf('#');
        const title = hash >= 0 ? destination.slice(0, hash) : destination;
        const heading = hash >= 0 ? destination.slice(hash) : '';
        const leading = title.match(/^\s*/)?.[0] ?? '';
        const trailing = title.match(/\s*$/)?.[0] ?? '';
        const trimmed = title.trim();
        const slash = trimmed.lastIndexOf('/');
        const path = slash >= 0 ? trimmed.slice(0, slash + 1) : '';
        const extension = trimmed.match(/\.md$/i)?.[0] ?? '';
        return `[[${leading}${path}${replacement.title}${extension}${trailing}${heading}${alias}]]`;
      }),
    ),
  }));
}

const seedTime = '2026-10-06T12:00:00.000Z';
function seed(id: string, title: string, folder: string, content: string, favorite = false): Note {
  return {
    id,
    title,
    folder,
    content,
    favorite,
    trashed: false,
    createdAt: seedTime,
    updatedAt: seedTime,
  };
}

export const SEED_NOTES: Note[] = [
  seed(
    'bienvenida',
    'Bienvenida a tu jardín mental',
    'Personal',
    `# Bienvenida a tu jardín mental

Un lugar tranquilo para pensar, conectar ideas y convertir conocimiento en acción.

> No necesitas recordarlo todo. Necesitas una forma de volver a encontrarlo.

## Empieza por aquí

- Explora tu [[Mapa de conocimiento]].
- Captura una idea en [[Ideas para explorar]].
- Organiza tu semana con [[Rutina semanal]].
- Dale forma a tu próximo proyecto en [[Proyecto Atlas]].

## Tu espacio, tus reglas

Escribe en Markdown, enlaza notas con **dobles corchetes** y añade etiquetas para encontrar patrones. Tus notas se guardan en este dispositivo; exporta una copia para conservarlas o trasladarlas.

#bienvenida #pkm #personal`,
    true,
  ),
  seed(
    'mapa',
    'Mapa de conocimiento',
    'Recursos',
    `# Mapa de conocimiento

Este mapa conecta las áreas que estoy cultivando. Cada enlace es una puerta a otra idea.

## Construir

[[Proyecto Atlas]] → [[Diseño del sistema]] → [[Ideas para explorar]]

## Aprender

[[Aprendizaje continuo]] → [[Lectura activa]] → [[Método Zettelkasten]]

## Vivir con intención

[[Rutina semanal]] · [[Bienvenida a tu jardín mental]]

## Biblioteca

Consulta [[Recursos y referencias|mis recursos favoritos]] y revisa el grafo para descubrir conexiones.

#mapa #pkm #recursos`,
    true,
  ),
  seed(
    'atlas',
    'Proyecto Atlas',
    'Proyectos',
    `# Proyecto Atlas

## Objetivo

Crear un sistema personal que transforme información dispersa en ideas útiles. Un proyecto pequeño, bien terminado, vale más que diez proyectos sin dirección.

## Próximas acciones

- [x] Definir el propósito y los criterios de éxito
- [x] Reunir referencias en [[Recursos y referencias]]
- [ ] Dibujar la arquitectura en [[Diseño del sistema]]
- [ ] Probar el flujo de captura con una nota real
- [ ] Programar una revisión en [[Rutina semanal]]

## Criterios de éxito

| Criterio | Resultado esperado |
| --- | --- |
| Captura | Registrar una idea en menos de un minuto |
| Conexión | Encontrar notas relacionadas sin duplicar trabajo |
| Portabilidad | Exportar todo a Markdown abierto |

Relacionado: [[Método Zettelkasten#Notas permanentes]] y [[Ideas para explorar]].

#proyecto #atlas #prioridad`,
    true,
  ),
  seed(
    'diseno',
    'Diseño del sistema',
    'Proyectos',
    `# Diseño del sistema

## Principios

1. **Primero lo local:** las notas pertenecen a quien las escribe.
2. **Formatos abiertos:** Markdown para contenido, JSON para respaldos.
3. **Conexiones explícitas:** cada vínculo debe aportar contexto.
4. **Simplicidad:** capturar, conectar y recuperar sin fricción.

## Flujo principal

Captura → elaboración → conexión → revisión.

Aplicaré este flujo en [[Proyecto Atlas]] usando [[Método Zettelkasten]] como guía.

## Preguntas abiertas

- ¿Qué información merece convertirse en una nota permanente?
- ¿Cómo encontrar relaciones sin crear una estructura demasiado rígida?

#diseño #proyecto #sistema`,
  ),
  seed(
    'aprendizaje',
    'Aprendizaje continuo',
    'Aprendizaje',
    `# Aprendizaje continuo

Aprender consiste en hacer preguntas mejores, explicar con mis propias palabras y aplicar lo aprendido.

## Mi ciclo de aprendizaje

1. Elijo una pregunta concreta.
2. Consulto [[Recursos y referencias]].
3. Practico [[Lectura activa]].
4. Escribo una nota con [[Método Zettelkasten]].
5. Relaciono la idea con [[Proyecto Atlas]] o con otra experiencia.

## Esta semana

- [ ] Leer un capítulo y resumirlo sin copiar
- [ ] Conectar dos ideas que parecían independientes
- [ ] Explicar un concepto a alguien más

#aprendizaje #hábitos`,
  ),
  seed(
    'zettelkasten',
    'Método Zettelkasten',
    'Aprendizaje',
    `# Método Zettelkasten

Un sistema de notas conectadas favorece el pensamiento a largo plazo. La unidad principal es una idea clara, escrita con palabras propias.

## Notas fugaces

Capturas rápidas que todavía necesitan contexto. Mi bandeja de entrada es [[Ideas para explorar]].

## Notas de literatura

Registro ideas de una fuente, su referencia y mi interpretación. Ver [[Lectura activa]].

## Notas permanentes

Una idea por nota, un título descriptivo y enlaces que expliquen sus conexiones.

> Pregunta útil: ¿qué cambia esta idea en lo que ya sé?

El [[Mapa de conocimiento]] sirve como punto de entrada, no como una clasificación rígida.

#zettelkasten #pkm #aprendizaje`,
  ),
  seed(
    'lectura',
    'Lectura activa',
    'Aprendizaje',
    `# Lectura activa

## Antes de leer

Escribo qué quiero comprender y qué sé sobre el tema.

## Durante la lectura

Marco afirmaciones que responden a mi pregunta y anoto dudas. Evito guardar párrafos sin interpretarlos.

## Después de leer

- [ ] Escribir un resumen de tres frases
- [ ] Seleccionar una idea que pueda aplicar
- [ ] Crear una nota permanente y conectarla

Esta práctica alimenta [[Aprendizaje continuo]] y [[Método Zettelkasten]]. Las fuentes están en [[Recursos y referencias]].

#lectura #aprendizaje #biblioteca`,
  ),
  seed(
    'ideas',
    'Ideas para explorar',
    'Personal',
    `# Ideas para explorar

Una bandeja de entrada sin presión. Primero capturo; después decido qué desarrollar.

## Semillas

- ¿Podría un [[Mapa de conocimiento]] funcionar como brújula semanal?
- Diseñar una rutina de lectura que empiece con una pregunta.
- Conectar creatividad y sistemas en [[Diseño del sistema]].

## Por investigar

- [ ] Probar notas de voz convertidas en borradores
- [ ] Explorar una línea temporal de proyectos personales

Revisar estas ideas en [[Rutina semanal]].

#ideas #captura #personal`,
  ),
  seed(
    'rutina',
    'Rutina semanal',
    'Personal',
    `# Rutina semanal

## Revisión del viernes

- [ ] Vaciar [[Ideas para explorar]]
- [ ] Revisar acciones pendientes de [[Proyecto Atlas]]
- [ ] Actualizar [[Mapa de conocimiento]]
- [ ] Exportar una copia de seguridad de la bóveda
- [x] Reservar un espacio para descansar

## Tres preguntas

1. ¿Qué aprendí esta semana?
2. ¿Qué merece mi atención la próxima?
3. ¿Qué puedo dejar de hacer?

La revisión conecta [[Aprendizaje continuo]] con mis decisiones cotidianas.

#rutina #hábitos #personal`,
    true,
  ),
  seed(
    'recursos',
    'Recursos y referencias',
    'Recursos',
    `# Recursos y referencias

## Una biblioteca pequeña y útil

- **How to Take Smart Notes**, Sönke Ahrens — ideas sobre notas conectadas y escritura.
- **Building a Second Brain**, Tiago Forte — captura y organización para proyectos.
- [Guía de Markdown](https://www.markdownguide.org/basic-syntax/) — una referencia para escribir en formatos abiertos.

## Cómo uso una fuente

No guardo una referencia sin explicar por qué me interesa. Cada lectura puede convertirse en una idea en [[Lectura activa]] y luego en una nota según [[Método Zettelkasten]].

## Plantilla de referencia

**Fuente:**
**Pregunta:**
**Idea principal:**
**Mi interpretación:**
**Conexiones:** [[Mapa de conocimiento]]

#recursos #biblioteca #referencias`,
  ),
];
