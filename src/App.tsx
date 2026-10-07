import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Compass,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  Hash,
  History,
  LayoutTemplate,
  Link2,
  List,
  LoaderCircle,
  Menu,
  Moon,
  Network,
  PanelRight,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useVault } from './hooks/useVault';
import {
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
  mergeImportedNotes,
  normalizeTitle,
  renameLinks,
  resolveNoteLink,
  searchNotes,
  toggleTask,
  type Note,
} from './lib/vault';
import { createSnapshot, listSnapshots, restoreSnapshot } from './lib/storage';
import { exportMarkdownZip, importFiles } from './lib/files';
import { MarkdownView } from './components/MarkdownView';
import { GraphView } from './components/GraphView';
import { Dialog } from './components/Dialog';

type Page = 'library' | 'graph' | 'tasks' | 'templates' | 'trash' | 'settings' | 'note';
type Filter = 'all' | 'favorite' | 'recent';
type Confirmation = {
  title: string;
  text: string;
  action: () => void | Promise<void>;
  danger?: boolean;
};
const TEMPLATES = [
  {
    title: 'Nota en blanco',
    icon: FileText,
    description: 'Un espacio abierto para tus ideas.',
    content: '',
  },
  {
    title: 'Proyecto',
    icon: Compass,
    description: 'Del propósito a los siguientes pasos.',
    content:
      '## Objetivo\n\n¿Qué queremos conseguir?\n\n## Ideas y referencias\n\n\n## Próximos pasos\n\n- [ ] Definir el primer paso\n\n#proyecto',
  },
  {
    title: 'Lectura',
    icon: BookOpen,
    description: 'Transforma lo que lees en conocimiento.',
    content:
      '## Fuente\n\nAutor · Título · Enlace\n\n## Ideas principales\n\n- \n\n## Mi reflexión\n\n\n## Conexiones\n\n#lectura',
  },
  {
    title: 'Reunión',
    icon: CalendarDays,
    description: 'Decisiones claras, acciones concretas.',
    content:
      '## Participantes\n\n\n## Agenda\n\n- \n\n## Decisiones\n\n\n## Acciones\n\n- [ ] Primera acción\n\n#reunión',
  },
];
const NAV: { page: Page; label: string; icon: typeof BookOpen }[] = [
  { page: 'library', label: 'Biblioteca', icon: BookOpen },
  { page: 'graph', label: 'Grafo de conocimiento', icon: Network },
  { page: 'tasks', label: 'Tareas', icon: CheckSquare },
  { page: 'templates', label: 'Plantillas', icon: LayoutTemplate },
];
const FOLDER_COLORS = ['sage', 'purple', 'amber', 'blue', 'rose'];
function colorFor(folder: string) {
  const known: Record<string, string> = {
    Proyectos: 'purple',
    Aprendizaje: 'sage',
    Personal: 'amber',
    Recursos: 'blue',
    Diario: 'rose',
  };
  return (
    known[folder] ??
    FOLDER_COLORS[
      Array.from(folder).reduce((sum, char) => sum + char.charCodeAt(0), 0) % FOLDER_COLORS.length
    ]
  );
}
function shortDate(value: string) {
  return new Date(value).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}
function snippet(content: string) {
  return (
    content
      .replace(/^#+\s.*$/gm, '')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2$1')
      .replace(/[#*_>`\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 125) || 'Una nueva idea empieza aquí…'
  );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export default function App() {
  const { vault, update, replace, loadError, saveError, saving, flush } = useVault();
  const [page, setPage] = useState<Page>('library');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [folderFilter, setFolderFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [showContext, setShowContext] = useState(true);
  const [editorMode, setEditorMode] = useState<'edit' | 'read' | 'split'>('read');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('atlas-theme') ?? 'light';
    } catch {
      return 'light';
    }
  });
  const [createDialog, setCreateDialog] = useState<{
    title: string;
    folder: string;
    content: string;
  } | null>(null);
  const [formError, setFormError] = useState('');
  const [folderDialog, setFolderDialog] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [searchDialog, setSearchDialog] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [taskFilter, setTaskFilter] = useState<'open' | 'done' | 'all'>('open');
  const [snapshots, setSnapshots] = useState<Awaited<ReturnType<typeof listSnapshots>>>([]);
  const [extraFolders, setExtraFolders] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('atlas-folders') ?? '[]');
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  });
  const importInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const modalOpen = Boolean(createDialog || folderDialog || searchDialog || confirm || help);

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  const closeCreate = useCallback(() => {
    setCreateDialog(null);
    setFormError('');
  }, []);
  const closeSearch = useCallback(() => {
    setSearchDialog(false);
    setCommandQuery('');
  }, []);
  const notes = vault?.notes ?? [];
  const activeNotes = useMemo(() => notes.filter((note) => !note.trashed), [notes]);
  const activeNote = notes.find((note) => note.id === activeId && !note.trashed);
  const folders = useMemo(
    () =>
      Array.from(new Set([...activeNotes.map((note) => note.folder), ...extraFolders])).sort(
        (a, b) => a.localeCompare(b),
      ),
    [activeNotes, extraFolders],
  );
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    activeNotes.forEach((note) =>
      extractTags(note.content).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)),
    );
    return Array.from(counts).sort((a, b) => b[1] - a[1]);
  }, [activeNotes]);
  const allTasks = useMemo(() => getTasks(activeNotes), [activeNotes]);
  const graph = useMemo(() => getGraphData(activeNotes), [activeNotes]);
  const visibleNotes = useMemo(() => {
    let result = searchNotes(notes, query).filter(
      (note) =>
        (!folderFilter || note.folder === folderFilter) &&
        (!tagFilter || extractTags(note.content).includes(tagFilter)),
    );
    if (filter === 'favorite') result = result.filter((note) => note.favorite);
    if (filter === 'recent')
      result = result.filter(
        (note) => Date.now() - new Date(note.updatedAt).getTime() < 30 * 86400000,
      );
    return result.sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'es')
        : new Date(sort === 'created' ? b.createdAt : b.updatedAt).getTime() -
          new Date(sort === 'created' ? a.createdAt : a.updatedAt).getTime(),
    );
  }, [notes, query, filter, folderFilter, tagFilter, sort]);
  const backlinks = activeNote ? getBacklinks(activeNote, activeNotes) : [];
  const outgoing = activeNote ? extractLinks(activeNote.content) : [];

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const resize = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileNav(false);
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('atlas-theme', theme);
    } catch {
      /* Browser preference storage is optional. */
    }
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem('atlas-folders', JSON.stringify(extraFolders));
    } catch {
      /* Folder names on actual notes remain persisted. */
    }
  }, [extraFolders]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setSearchDialog(true);
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setCreateDialog({ title: '', folder: folderFilter || 'Notas', content: '' });
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flush()
          .then(() => notify('Cambios guardados'))
          .catch(() => {});
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [folderFilter, flush, notify]);
  useEffect(() => {
    if (page === 'settings')
      void listSnapshots()
        .then(setSnapshots)
        .catch((error) => notify(String(error)));
  }, [page, notify]);

  function go(next: Page) {
    setPage(next);
    setMobileNav(false);
    if (next === 'library') {
      setFolderFilter('');
      setTagFilter('');
      setQuery('');
    }
  }
  function openNote(id: string) {
    setActiveId(id);
    setPage('note');
    setEditorMode('read');
    setMobileNav(false);
    closeSearch();
  }
  function patchNote(id: string, patch: Partial<Note>) {
    update((current) =>
      current.map((note) =>
        note.id === id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note,
      ),
    );
  }
  function addNote(title: string, folder: string, content: string) {
    const existing = activeNotes.find(
      (note) => normalizeTitle(note.title) === normalizeTitle(title),
    );
    if (existing)
      throw new Error(
        'Ya existe una nota con este título. Elige otro para que los enlaces sean inequívocos.',
      );
    const note = createNote(title.trim(), folder.trim() || 'Notas', content);
    update((current) => [...current, note]);
    openNote(note.id);
    setEditorMode('edit');
    return note;
  }
  function submitNote(event: FormEvent) {
    event.preventDefault();
    if (!createDialog) return;
    try {
      addNote(createDialog.title, createDialog.folder, createDialog.content);
      closeCreate();
      notify('Nota creada. Tu próxima idea tiene un lugar.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo crear la nota.');
    }
  }
  function navigateTitle(title: string) {
    const clean = title.split('#')[0];
    const found = resolveNoteLink(clean, activeNotes);
    if (found) openNote(found.id);
    else {
      setFormError('');
      setCreateDialog({ title: clean, folder: activeNote?.folder ?? 'Notas', content: '' });
    }
  }
  function daily() {
    const title = dailyNoteTitle();
    const note = activeNotes.find((item) => item.title === title && item.folder === 'Diario');
    if (note) openNote(note.id);
    else {
      try {
        addNote(
          title,
          'Diario',
          '## Hoy quiero…\n\n\n## Ideas del día\n\n\n## Pendientes\n\n- [ ] Mi prioridad de hoy\n\n## Un momento para recordar\n\n#diario',
        );
        notify('Tu nota de hoy está lista');
      } catch (error) {
        notify(String(error));
      }
    }
  }
  async function runOperation(operation: () => Promise<void>) {
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function doExport(format: 'json' | 'zip') {
    if (!vault) return;
    await runOperation(async () => {
      await flush();
      if (format === 'json')
        download(
          new Blob([exportVault(vault)], { type: 'application/json' }),
          'atlas-' + dailyNoteTitle() + '.json',
        );
      else
        download(
          await exportMarkdownZip(activeNotes),
          'atlas-markdown-' + dailyNoteTitle() + '.zip',
        );
      notify('Copia exportada. Guárdala en un lugar seguro.');
    });
  }
  async function importSelected(files: File[]) {
    if (!files.length || !vault) return;
    await runOperation(async () => {
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.json')) {
        if (files[0].size > 20 * 1024 * 1024)
          throw new Error('La copia supera el límite de 20 MB.');
        const imported = importVault(await files[0].text());
        setConfirm({
          title: 'Restaurar una copia de Atlas',
          text:
            'Se reemplazarán tus notas por las ' +
            imported.notes.length +
            ' notas de esta copia. Antes guardaremos una instantánea de tu bóveda actual.',
          action: async () => {
            await flush();
            await createSnapshot(vault);
            replace(imported);
            setPage('library');
            setActiveId(null);
            notify('Copia restaurada');
          },
        });
      } else {
        const imported = await importFiles(files);
        const unique = mergeImportedNotes(notes, imported);
        update((current) => [...current, ...unique]);
        go('library');
        notify(unique.length + ' notas importadas');
      }
    });
  }
  function renameTitle(value: string) {
    if (!activeNote) return false;
    if (value === activeNote.title) return true;
    const title = value.trim();
    if (!title) {
      notify('El título no puede estar vacío');
      return false;
    }
    if (
      activeNotes.some(
        (note) => note.id !== activeNote.id && normalizeTitle(note.title) === normalizeTitle(title),
      )
    ) {
      notify('Ya existe una nota con ese título');
      return false;
    }
    try {
      createNote(title, activeNote.folder);
      update((current) =>
        renameLinks(
          current.map((note) =>
            note.id === activeNote.id
              ? { ...note, title, updatedAt: new Date().toISOString() }
              : note,
          ),
          activeNote.title,
          title,
        ),
      );
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Título no válido.');
      return false;
    }
  }
  function insertMarkdown(before: string, after = '') {
    const element = editor.current;
    if (!element || !activeNote) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = activeNote.content.slice(start, end) || 'texto';
    patchNote(activeNote.id, {
      content:
        activeNote.content.slice(0, start) +
        before +
        selected +
        after +
        activeNote.content.slice(end),
    });
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }
  function createFolder(event: FormEvent) {
    event.preventDefault();
    try {
      const name = newFolder.trim();
      createNote('validación', name);
      if (!name) throw new Error('Escribe un nombre de carpeta.');
      if (folders.includes(name)) throw new Error('Esta carpeta ya existe.');
      setExtraFolders((current) => [...current, name]);
      setFolderFilter(name);
      setTagFilter('');
      setPage('library');
      setFolderDialog(false);
      setNewFolder('');
      setFormError('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Carpeta no válida.');
    }
  }

  if (loadError)
    return (
      <div className="startup-screen">
        <ShieldCheck size={44} />
        <h1>No pudimos abrir tu bóveda</h1>
        <p>{loadError}</p>
        <p>
          Activa el almacenamiento del navegador y vuelve a intentarlo. Tus datos existentes no se
          han reemplazado.
        </p>
        <button className="primary-button" onClick={() => location.reload()}>
          Volver a intentar
        </button>
      </div>
    );
  if (!vault)
    return (
      <div className="startup-screen">
        <div className="brand-logo">
          <Compass />
        </div>
        <h1>Atlas</h1>
        <LoaderCircle className="spin" size={24} />
        <p>Preparando tu espacio de conocimiento…</p>
      </div>
    );

  const pageTitle =
    page === 'note'
      ? (activeNote?.title ?? 'Nota')
      : page === 'graph'
        ? 'Grafo de conocimiento'
        : page === 'tasks'
          ? 'Tareas'
          : page === 'templates'
            ? 'Plantillas'
            : page === 'settings'
              ? 'Ajustes'
              : page === 'trash'
                ? 'Papelera'
                : 'Biblioteca';
  const libraryTitle =
    folderFilter || (tagFilter ? '#' + tagFilter : 'Tu conocimiento, conectado.');
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Ir al contenido
      </a>
      {mobileNav && (
        <button
          className="nav-overlay"
          aria-label="Cerrar navegación"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={'sidebar ' + (mobileNav ? 'sidebar-open' : '')}
        inert={modalOpen || (isMobile && !mobileNav)}
      >
        <button className="brand" onClick={() => go('library')} aria-label="Atlas, ir a Biblioteca">
          <span className="brand-logo">
            <Compass size={24} strokeWidth={1.7} />
          </span>
          <span>
            atlas<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="workspace-switch">
          <span className="workspace-avatar">M</span>
          <div>
            <strong>Mi espacio personal</strong>
            <span>Tu segundo cerebro</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">MI CONOCIMIENTO</div>
        <nav aria-label="Navegación principal">
          {NAV.slice(0, 2).map((item) => (
            <button
              key={item.page}
              onClick={() => {
                go(item.page);
                setFilter('all');
              }}
              className={
                'nav-item ' + (page === item.page && !folderFilter && !tagFilter ? 'active' : '')
              }
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.page === 'library' && <span className="nav-count">{activeNotes.length}</span>}
            </button>
          ))}
          <button
            onClick={daily}
            className={
              'nav-item ' + (activeNote?.folder === 'Diario' && page === 'note' ? 'active' : '')
            }
          >
            <CalendarDays size={18} />
            <span>Notas diarias</span>
          </button>
          {NAV.slice(2).map((item) => (
            <button
              key={item.page}
              onClick={() => go(item.page)}
              className={'nav-item ' + (page === item.page ? 'active' : '')}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.page === 'tasks' && allTasks.some((task) => !task.completed) && (
                <span className="nav-count">
                  {allTasks.filter((task) => !task.completed).length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label section-label">
          <span>CARPETAS</span>
          <button
            className="tiny-button"
            aria-label="Crear carpeta"
            onClick={() => {
              setFolderDialog(true);
              setFormError('');
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav className="folder-navigation" aria-label="Carpetas">
          {folders.map((folder) => (
            <button
              key={folder}
              className={
                'nav-item folder-item ' +
                (folderFilter === folder && page === 'library' ? 'active' : '')
              }
              onClick={() => {
                setFolderFilter(folder);
                setTagFilter('');
                setQuery('');
                setFilter('all');
                setPage('library');
                setMobileNav(false);
              }}
            >
              <ChevronRight size={12} />
              <Folder size={16} className={'folder-' + colorFor(folder)} />
              <span>{folder}</span>
              <span className="folder-count">
                {activeNotes.filter((note) => note.folder === folder).length}
              </span>
            </button>
          ))}
        </nav>
        <div className="nav-label section-label">
          <span>ETIQUETAS</span>
          <Hash size={13} />
        </div>
        <div className="sidebar-tags">
          {tags.slice(0, 8).map(([tag]) => (
            <button
              key={tag}
              className={tagFilter === tag ? 'tag active-tag' : 'tag'}
              onClick={() => {
                setTagFilter(tag);
                setFolderFilter('');
                setQuery('');
                setFilter('all');
                setPage('library');
                setMobileNav(false);
              }}
            >
              <span>#</span>
              {tag}
            </button>
          ))}
          {!tags.length && <span className="muted tiny">Añade #etiquetas en tus notas</span>}
        </div>
        <div className="sidebar-bottom">
          <button
            className={'nav-item ' + (page === 'trash' ? 'active' : '')}
            onClick={() => go('trash')}
          >
            <Trash2 size={17} />
            <span>Papelera</span>
            {notes.some((note) => note.trashed) && (
              <span className="nav-count">{notes.filter((note) => note.trashed).length}</span>
            )}
          </button>
          <div className="sidebar-footer">
            <span className="local-status">
              <span className="status-dot" />
              Guardado en este dispositivo
            </span>
            <button className="icon-button" aria-label="Ajustes" onClick={() => go('settings')}>
              <Settings size={17} />
            </button>
          </div>
          <button className="profile" onClick={() => go('settings')}>
            <span className="profile-avatar">T</span>
            <div>
              <strong>Tu espacio, tus ideas</strong>
              <span>Personal · Local</span>
            </div>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>

      <div className="workspace" inert={modalOpen || (isMobile && mobileNav)}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir navegación"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <BookOpen size={16} />
            <span className="breadcrumb-root">Mi espacio</span>
            <ChevronRight size={13} />
            <span>{pageTitle}</span>
          </div>
          <div className="top-actions">
            <button
              className="search-trigger"
              aria-label="Buscar en tu espacio"
              onClick={() => setSearchDialog(true)}
            >
              <Search size={15} />
              <span>Buscar en tu espacio</span>
              <kbd>
                <Command size={11} /> K
              </kbd>
            </button>
            <button
              className="icon-button theme-button"
              aria-label={theme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro'}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <span className="topbar-separator" />
            <button
              className="primary-button new-note-button"
              onClick={() => {
                setFormError('');
                setCreateDialog({ title: '', folder: folderFilter || 'Notas', content: '' });
              }}
            >
              <Plus size={17} />
              <span>Nueva nota</span>
            </button>
          </div>
        </header>
        {saveError && (
          <div className="error-banner" role="alert">
            <ShieldCheck size={17} />
            <span>No se han guardado los últimos cambios: {saveError}</span>
            <button
              onClick={() => {
                void flush().catch(() => {});
              }}
            >
              Reintentar
            </button>
          </div>
        )}
        <div
          className={
            'workspace-body ' +
            (page === 'library' || page === 'note' ? 'with-context' : '') +
            (!showContext ? ' context-hidden' : '')
          }
        >
          <main id="main-content" className={'main-content page-' + page}>
            {page === 'library' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      <span className="eyebrow-line" />
                      UN LUGAR PARA TUS IDEAS
                    </div>
                    <h1>{libraryTitle}</h1>
                    <p>
                      {folderFilter
                        ? 'Cada nota, una pieza de algo más grande.'
                        : tagFilter
                          ? 'Ideas que comparten un mismo hilo.'
                          : 'Captura ideas, encuentra conexiones y construye tu segundo cerebro.'}
                    </p>
                  </div>
                  <button
                    className="icon-button context-toggle"
                    aria-label="Mostrar u ocultar panel de contexto"
                    onClick={() => setShowContext(!showContext)}
                  >
                    <PanelRight size={19} />
                  </button>
                </div>
                {!folderFilter && !tagFilter && (
                  <div className="stats-grid">
                    <div className="stat-card">
                      <span className="stat-icon purple">
                        <FileText size={18} />
                      </span>
                      <div>
                        <strong>
                          {activeNotes.length}
                          <span>notas</span>
                        </strong>
                        <p>Ideas que siguen creciendo</p>
                      </div>
                      <svg className="sparkline" viewBox="0 0 60 28" aria-hidden="true">
                        <path d="M2 24 12 21 19 23 29 14 37 16 47 8 57 4" />
                      </svg>
                    </div>
                    <div className="stat-card">
                      <span className="stat-icon sage">
                        <Link2 size={18} />
                      </span>
                      <div>
                        <strong>
                          {graph.edges.length}
                          <span>conexiones</span>
                        </strong>
                        <p>El valor está en los vínculos</p>
                      </div>
                      <div className="connection-decoration">
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                    <div className="stat-card">
                      <span className="stat-icon amber">
                        <Folder size={18} />
                      </span>
                      <div>
                        <strong>
                          {folders.length}
                          <span>carpetas</span>
                        </strong>
                        <p>Un poco de orden, mucha claridad</p>
                      </div>
                    </div>
                  </div>
                )}
                {!folderFilter && !tagFilter && !query && (
                  <div className="daily-banner">
                    <div className="daily-art">
                      <Sparkles size={25} />
                      <span className="art-star star-one" aria-hidden="true">
                        ✦
                      </span>
                      <span className="art-star star-two" aria-hidden="true">
                        ✧
                      </span>
                    </div>
                    <div>
                      <span className="tiny-uppercase">UN PEQUEÑO HÁBITO, GRANDES IDEAS</span>
                      <h3>¿Qué tienes en mente hoy?</h3>
                      <p>Despeja tu mente. Tu nota diaria te está esperando.</p>
                    </div>
                    <button onClick={daily}>
                      Abrir nota de hoy
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                )}
                <section className="notes-section" aria-label="Tus notas">
                  <div className="section-heading">
                    <h2>
                      {folderFilter || tagFilter ? 'Notas' : 'Tu biblioteca'}{' '}
                      <span>{visibleNotes.length}</span>
                    </h2>
                    <button
                      className="text-button import-link"
                      onClick={() => importInput.current?.click()}
                    >
                      <Upload size={14} />
                      Importar notas
                    </button>
                  </div>
                  <div className="notes-toolbar">
                    <div className="tabs" role="tablist" aria-label="Filtrar notas">
                      {(['all', 'favorite', 'recent'] as const).map((item) => (
                        <button
                          key={item}
                          role="tab"
                          aria-selected={filter === item}
                          className={filter === item ? 'selected' : ''}
                          onClick={() => setFilter(item)}
                        >
                          {item === 'all'
                            ? 'Todas las notas'
                            : item === 'favorite'
                              ? 'Favoritas'
                              : 'Recientes'}
                          {item === 'favorite' && <Star size={13} />}
                        </button>
                      ))}
                    </div>
                    <div className="view-tools">
                      <select
                        aria-label="Ordenar notas"
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                      >
                        <option value="updated">Última edición</option>
                        <option value="created">Fecha de creación</option>
                        <option value="title">Título A–Z</option>
                      </select>
                      <div className="layout-toggle">
                        <button
                          aria-label="Vista de lista"
                          aria-pressed={layout === 'list'}
                          className={layout === 'list' ? 'selected' : ''}
                          onClick={() => setLayout('list')}
                        >
                          <List size={16} />
                        </button>
                        <button
                          aria-label="Vista de tarjetas"
                          aria-pressed={layout === 'grid'}
                          className={layout === 'grid' ? 'selected' : ''}
                          onClick={() => setLayout('grid')}
                        >
                          <Grid2X2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="inline-search">
                    <Search size={15} />
                    <input
                      aria-label="Filtrar biblioteca"
                      placeholder="Encuentra una idea, una etiqueta, una conexión…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query && (
                      <button
                        className="tiny-button"
                        aria-label="Limpiar búsqueda"
                        onClick={() => setQuery('')}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  {visibleNotes.length ? (
                    <div className={'note-list ' + (layout === 'grid' ? 'note-grid' : '')}>
                      {visibleNotes.map((note) => (
                        <article className="note-card" key={note.id}>
                          <button className="note-open" onClick={() => openNote(note.id)}>
                            <span className={'note-icon ' + colorFor(note.folder)}>
                              <FileText size={19} strokeWidth={1.6} />
                            </span>
                            <div className="note-card-body">
                              <div className="note-title">
                                <h3>{note.title}</h3>
                                {note.favorite && <Star size={12} className="filled-star" />}
                              </div>
                              <p>{snippet(note.content)}</p>
                              <div className="note-meta">
                                <span>
                                  <Folder size={11} />
                                  {note.folder}
                                </span>
                                {extractTags(note.content)
                                  .slice(0, 2)
                                  .map((tag) => (
                                    <span className="meta-tag" key={tag}>
                                      #{tag}
                                    </span>
                                  ))}
                                <span className="note-date">{shortDate(note.updatedAt)}</span>
                              </div>
                            </div>
                          </button>
                          <button
                            className={
                              'note-favorite icon-button ' + (note.favorite ? 'is-favorite' : '')
                            }
                            aria-label={
                              (note.favorite ? 'Quitar de favoritas: ' : 'Añadir a favoritas: ') +
                              note.title
                            }
                            onClick={() => patchNote(note.id, { favorite: !note.favorite })}
                          >
                            <Star size={16} />
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={<Search size={27} />}
                      title={query ? 'No encontramos esa idea' : 'Aquí empieza algo nuevo'}
                      text={
                        query
                          ? 'Prueba otra palabra o usa filtros como tag:idea y folder:Proyectos.'
                          : 'Crea tu primera nota en este espacio.'
                      }
                      action={
                        <button
                          className="primary-button"
                          onClick={() =>
                            setCreateDialog({
                              title: '',
                              folder: folderFilter || 'Notas',
                              content: '',
                            })
                          }
                        >
                          <Plus size={16} />
                          Crear nota
                        </button>
                      }
                    />
                  )}
                </section>
                <footer className="main-footer">
                  <span>
                    <ShieldCheck size={13} />
                    Tus ideas son tuyas. Siempre.
                  </span>
                  <span>
                    Hecho para pensar con calma{' '}
                    <span className="footer-flower" aria-hidden="true">
                      ✳
                    </span>
                  </span>
                </footer>
              </>
            )}

            {page === 'note' &&
              (activeNote ? (
                <>
                  <div className="editor-breadcrumb">
                    <button className="text-button" onClick={() => go('library')}>
                      <ArrowLeft size={15} />
                      Biblioteca
                    </button>
                    <span>/</span>
                    <span>
                      <Folder size={13} />
                      {activeNote.folder}
                    </span>
                    <span className="save-state" role="status">
                      {saving ? (
                        <>
                          <LoaderCircle size={12} className="spin" />
                          Guardando…
                        </>
                      ) : saveError ? (
                        'Error al guardar'
                      ) : (
                        <>
                          <CheckCheck size={13} />
                          Guardado
                        </>
                      )}
                    </span>
                  </div>
                  <div className="note-heading">
                    <input
                      key={activeNote.id + activeNote.title}
                      className="note-title-input"
                      aria-label="Título de la nota"
                      defaultValue={activeNote.title}
                      onBlur={(event) => {
                        if (!renameTitle(event.target.value)) event.target.value = activeNote.title;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                    />
                    <div className="note-details">
                      <select
                        aria-label="Carpeta de la nota"
                        value={activeNote.folder}
                        onChange={(event) =>
                          patchNote(activeNote.id, { folder: event.target.value })
                        }
                      >
                        {folders.map((folder) => (
                          <option key={folder}>{folder}</option>
                        ))}
                      </select>
                      <span>Actualizada {shortDate(activeNote.updatedAt)}</span>
                      <span>{countWords(activeNote.content)} palabras</span>
                    </div>
                  </div>
                  <div className="editor-controls">
                    <div className="segmented-control">
                      {(['edit', 'read', 'split'] as const).map((mode) => (
                        <button
                          key={mode}
                          className={editorMode === mode ? 'selected' : ''}
                          onClick={() => setEditorMode(mode)}
                        >
                          {mode === 'edit' ? (
                            <Pencil size={14} />
                          ) : mode === 'read' ? (
                            <BookOpen size={14} />
                          ) : (
                            <PanelRight size={14} />
                          )}
                          {mode === 'edit' ? 'Escribir' : mode === 'read' ? 'Leer' : 'Dividir'}
                        </button>
                      ))}
                    </div>
                    <div className="editor-actions">
                      <button
                        className={'icon-button ' + (activeNote.favorite ? 'is-favorite' : '')}
                        aria-label={
                          activeNote.favorite
                            ? 'Quitar nota de favoritas'
                            : 'Añadir nota a favoritas'
                        }
                        onClick={() => patchNote(activeNote.id, { favorite: !activeNote.favorite })}
                      >
                        <Star size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Exportar esta nota como Markdown"
                        onClick={() =>
                          download(
                            new Blob([activeNote.content], { type: 'text/markdown' }),
                            activeNote.title.replace(/[/\\]/g, '-') + '.md',
                          )
                        }
                      >
                        <Download size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Duplicar nota"
                        onClick={() => {
                          let title = activeNote.title + ' (copia)';
                          let number = 2;
                          while (activeNotes.some((note) => note.title === title))
                            title = activeNote.title + ' (copia ' + number++ + ')';
                          addNote(title, activeNote.folder, activeNote.content);
                          notify('Nota duplicada');
                        }}
                      >
                        <Copy size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Mover nota a la papelera"
                        onClick={() => {
                          patchNote(activeNote.id, { trashed: true });
                          go('library');
                          notify('Nota movida a la papelera');
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Mostrar u ocultar panel de contexto"
                        onClick={() => setShowContext(!showContext)}
                      >
                        <PanelRight size={17} />
                      </button>
                    </div>
                  </div>
                  {editorMode !== 'read' && (
                    <div className="format-toolbar">
                      <button
                        aria-label="Insertar negrita"
                        onClick={() => insertMarkdown('**', '**')}
                      >
                        <strong>B</strong>
                      </button>
                      <button
                        aria-label="Insertar cursiva"
                        onClick={() => insertMarkdown('*', '*')}
                      >
                        <em>I</em>
                      </button>
                      <button aria-label="Insertar título" onClick={() => insertMarkdown('\n## ')}>
                        H₂
                      </button>
                      <span />
                      <button
                        aria-label="Insertar enlace entre notas"
                        onClick={() => insertMarkdown('[[', ']]')}
                      >
                        <Link2 size={15} />
                      </button>
                      <button
                        aria-label="Insertar tarea"
                        onClick={() => insertMarkdown('\n- [ ] ')}
                      >
                        <CheckSquare size={15} />
                      </button>
                      <button aria-label="Insertar cita" onClick={() => insertMarkdown('\n> ')}>
                        ❝
                      </button>
                      <button
                        aria-label="Insertar bloque de código"
                        onClick={() => insertMarkdown('\n```\n', '\n```\n')}
                      >
                        <span className="code-symbol">&lt;/&gt;</span>
                      </button>
                      <div className="toolbar-hint">Markdown · [[enlaces]] · #etiquetas</div>
                    </div>
                  )}
                  <div className={'editor-area mode-' + editorMode}>
                    {editorMode !== 'read' && (
                      <textarea
                        ref={editor}
                        aria-label="Contenido Markdown de la nota"
                        className="markdown-editor"
                        placeholder={
                          'Una idea, una pregunta, una conexión…\n\nEscribe en Markdown. Conecta notas con [[Título]] y organiza con #etiquetas.'
                        }
                        value={activeNote.content}
                        onChange={(event) =>
                          patchNote(activeNote.id, { content: event.target.value })
                        }
                        spellCheck
                        onKeyDown={(event) => {
                          if (event.key === 'Tab') {
                            event.preventDefault();
                            const start = event.currentTarget.selectionStart;
                            const end = event.currentTarget.selectionEnd;
                            patchNote(activeNote.id, {
                              content:
                                activeNote.content.slice(0, start) +
                                '  ' +
                                activeNote.content.slice(end),
                            });
                            requestAnimationFrame(() =>
                              editor.current?.setSelectionRange(start + 2, start + 2),
                            );
                          }
                        }}
                      />
                    )}
                    {editorMode !== 'edit' && (
                      <div className="reading-pane">
                        <MarkdownView
                          content={activeNote.content || '*Esta nota espera tu primera idea.*'}
                          onNavigate={navigateTitle}
                          onToggleTask={(line) =>
                            patchNote(activeNote.id, {
                              content: toggleTask(activeNote.content, line),
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                  <div className="editor-bottom">
                    <span>
                      {extractTags(activeNote.content).map((tag) => (
                        <button
                          className="tag"
                          key={tag}
                          onClick={() => {
                            setTagFilter(tag);
                            setFolderFilter('');
                            setPage('library');
                          }}
                        >
                          #{tag}
                        </button>
                      ))}
                    </span>
                    <span>
                      {activeNote.content.length} caracteres ·{' '}
                      {Math.max(1, Math.ceil(countWords(activeNote.content) / 200))} min de lectura
                    </span>
                  </div>
                </>
              ) : (
                <Empty
                  icon={<FileText size={30} />}
                  title="Esta nota no está disponible"
                  text="Puede estar en la papelera. Busca otra idea en tu biblioteca."
                  action={
                    <button className="primary-button" onClick={() => go('library')}>
                      Volver a la biblioteca
                    </button>
                  }
                />
              ))}

            {page === 'graph' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      <span className="eyebrow-line" />
                      LAS IDEAS NO VIVEN SOLAS
                    </div>
                    <h1>Todo está conectado.</h1>
                    <p>
                      Explora las relaciones entre tus notas. Cada vínculo abre un nuevo camino.
                    </p>
                  </div>
                  <span className="small-badge">
                    <Network size={14} />
                    {graph.nodes.length} notas · {graph.edges.length} conexiones
                  </span>
                </div>
                <div className="full-graph">
                  <GraphView
                    notes={activeNotes}
                    activeId={activeId ?? undefined}
                    onSelect={openNote}
                  />
                </div>
                <div className="graph-tip">
                  <Sparkles size={18} />
                  <p>
                    Conecta tus ideas escribiendo <code>[[Título de una nota]]</code>. Los vínculos
                    aparecerán aquí automáticamente.
                  </p>
                </div>
              </>
            )}

            {page === 'tasks' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      <span className="eyebrow-line" />
                      DE LAS IDEAS A LA ACCIÓN
                    </div>
                    <h1>Un paso a la vez.</h1>
                    <p>Todos tus pendientes, reunidos desde tus notas.</p>
                  </div>
                  <span className="small-badge">
                    <CheckSquare size={14} />
                    {allTasks.filter((task) => !task.completed).length} pendientes
                  </span>
                </div>
                <div className="tabs standalone-tabs">
                  {(['open', 'done', 'all'] as const).map((value) => (
                    <button
                      className={taskFilter === value ? 'selected' : ''}
                      key={value}
                      onClick={() => setTaskFilter(value)}
                    >
                      {value === 'open' ? 'Pendientes' : value === 'done' ? 'Completadas' : 'Todas'}
                    </button>
                  ))}
                </div>
                <div className="tasks-list">
                  {allTasks
                    .filter(
                      (task) =>
                        taskFilter === 'all' ||
                        (taskFilter === 'done' ? task.completed : !task.completed),
                    )
                    .map((task) => (
                      <div
                        className={'task-row ' + (task.completed ? 'task-done' : '')}
                        key={task.noteId + '-' + task.line}
                      >
                        <input
                          type="checkbox"
                          aria-label={'Completar tarea: ' + task.text}
                          checked={task.completed}
                          onChange={() => {
                            const note = notes.find((note) => note.id === task.noteId);
                            if (note)
                              patchNote(note.id, { content: toggleTask(note.content, task.line) });
                          }}
                        />
                        <div>
                          <span>{task.text}</span>
                          <button onClick={() => openNote(task.noteId)}>
                            <FileText size={12} />
                            {task.noteTitle}
                            <ArrowUpRight size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
                {!allTasks.filter(
                  (task) =>
                    taskFilter === 'all' ||
                    (taskFilter === 'done' ? task.completed : !task.completed),
                ).length && (
                  <Empty
                    icon={<CheckCheck size={30} />}
                    title={
                      taskFilter === 'done' ? 'Cada pequeño paso cuenta' : 'Una mente despejada'
                    }
                    text={
                      taskFilter === 'done'
                        ? 'Tus tareas completadas aparecerán aquí.'
                        : 'No tienes tareas pendientes. Añade una escribiendo - [ ] en cualquier nota.'
                    }
                  />
                )}
              </>
            )}

            {page === 'templates' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      <span className="eyebrow-line" />
                      NO EMPIECES DESDE CERO
                    </div>
                    <h1>Un impulso para tus ideas.</h1>
                    <p>Estructuras sencillas para escribir con más intención.</p>
                  </div>
                </div>
                <div className="template-grid">
                  {TEMPLATES.map((template, index) => (
                    <button
                      className="template-card"
                      key={template.title}
                      onClick={() =>
                        setCreateDialog({
                          title: '',
                          folder: index === 1 ? 'Proyectos' : index === 2 ? 'Aprendizaje' : 'Notas',
                          content: template.content,
                        })
                      }
                    >
                      <div className={'template-icon ' + FOLDER_COLORS[index]}>
                        <template.icon size={26} strokeWidth={1.4} />
                      </div>
                      <h3>{template.title}</h3>
                      <p>{template.description}</p>
                      <span>
                        Usar plantilla
                        <ArrowUpRight size={16} />
                      </span>
                      <div className="template-lines">
                        <i />
                        <i />
                        <i />
                      </div>
                    </button>
                  ))}
                </div>
                <div className="graph-tip">
                  <LayoutTemplate size={19} />
                  <p>
                    También puedes guardar tus propias plantillas como notas en una carpeta llamada{' '}
                    <strong>Plantillas</strong> y duplicarlas cuando las necesites.
                  </p>
                </div>
                {activeNotes
                  .filter((note) => note.folder === 'Plantillas')
                  .map((note) => (
                    <button
                      key={note.id}
                      className="custom-template"
                      onClick={() =>
                        setCreateDialog({ title: '', folder: 'Notas', content: note.content })
                      }
                    >
                      <FileText size={17} />
                      <span>{note.title}</span>
                      <span className="text-button">
                        Usar plantilla
                        <ArrowUpRight size={14} />
                      </span>
                    </button>
                  ))}
              </>
            )}

            {page === 'trash' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      <span className="eyebrow-line" />
                      SIEMPRE PUEDES VOLVER
                    </div>
                    <h1>Papelera</h1>
                    <p>Las notas permanecen aquí hasta que decidas eliminarlas.</p>
                  </div>
                  {notes.some((note) => note.trashed) && (
                    <button
                      className="danger-button"
                      onClick={() =>
                        setConfirm({
                          title: 'Vaciar la papelera',
                          text: 'Se eliminarán definitivamente todas las notas de la papelera. Esta acción no se puede deshacer.',
                          danger: true,
                          action: () => {
                            update((current) => current.filter((note) => !note.trashed));
                            notify('Papelera vaciada');
                          },
                        })
                      }
                    >
                      <Trash2 size={15} />
                      Vaciar papelera
                    </button>
                  )}
                </div>
                {notes
                  .filter((note) => note.trashed)
                  .map((note) => (
                    <div className="trash-row" key={note.id}>
                      <FileText size={20} />
                      <div>
                        <strong>{note.title}</strong>
                        <span>
                          {note.folder} · {shortDate(note.updatedAt)}
                        </span>
                      </div>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          patchNote(note.id, { trashed: false });
                          notify('Nota restaurada');
                        }}
                      >
                        <History size={14} />
                        Restaurar
                      </button>
                      <button
                        className="icon-button"
                        aria-label={'Eliminar definitivamente: ' + note.title}
                        onClick={() =>
                          setConfirm({
                            title: 'Eliminar definitivamente',
                            text:
                              'La nota «' +
                              note.title +
                              '» se eliminará de este dispositivo. Esta acción no se puede deshacer.',
                            danger: true,
                            action: () =>
                              update((current) => current.filter((item) => item.id !== note.id)),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                {!notes.some((note) => note.trashed) && (
                  <Empty
                    icon={<Trash2 size={29} />}
                    title="Nada se pierde por accidente"
                    text="Las notas que elimines aparecerán aquí para que puedas recuperarlas."
                  />
                )}
              </>
            )}

            {page === 'settings' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      <span className="eyebrow-line" />A TU MANERA
                    </div>
                    <h1>Tu espacio. Tus reglas.</h1>
                    <p>Cuida tus datos y haz de Atlas un lugar propio.</p>
                  </div>
                </div>
                <section className="settings-section">
                  <h2>
                    <ShieldCheck size={19} />
                    Privacidad y almacenamiento
                  </h2>
                  <div className="privacy-card">
                    <span className="privacy-icon">
                      <ShieldCheck size={28} />
                    </span>
                    <div>
                      <strong>Tu conocimiento se queda contigo</strong>
                      <p>
                        Las notas se guardan en IndexedDB en este navegador. No enviamos tus notas a
                        un servidor. No hay cuentas ni seguimiento.
                      </p>
                      <span className="tiny muted">
                        Exporta una copia antes de borrar los datos del navegador o cambiar de
                        dispositivo. Usa una sola pestaña para editar tu bóveda.
                      </span>
                    </div>
                    <span className="small-badge">
                      <span className="status-dot" />
                      Local
                    </span>
                  </div>
                </section>
                <section className="settings-section">
                  <h2>
                    <Download size={19} />
                    Importar y exportar
                  </h2>
                  <p className="muted">
                    Tus archivos, en formatos abiertos. Importa Markdown de Obsidian o conserva una
                    copia completa.
                  </p>
                  <div className="settings-action-grid">
                    <button
                      className="settings-action"
                      disabled={busy}
                      onClick={() => {
                        void doExport('json');
                      }}
                    >
                      <Download size={21} />
                      <strong>Copia completa</strong>
                      <span>JSON · Notas, favoritos y papelera</span>
                      <ArrowUpRight size={16} />
                    </button>
                    <button
                      className="settings-action"
                      disabled={busy}
                      onClick={() => {
                        void doExport('zip');
                      }}
                    >
                      <Folder size={21} />
                      <strong>Exportar Markdown</strong>
                      <span>ZIP · Carpetas y notas .md</span>
                      <ArrowUpRight size={16} />
                    </button>
                    <button
                      className="settings-action"
                      disabled={busy}
                      onClick={() => importInput.current?.click()}
                    >
                      <Upload size={21} />
                      <strong>Importar conocimiento</strong>
                      <span>Markdown, ZIP o copia JSON</span>
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h2>
                      <History size={19} />
                      Instantáneas locales
                    </h2>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        void runOperation(async () => {
                          await flush();
                          await createSnapshot(vault);
                          setSnapshots(await listSnapshots());
                          notify('Instantánea creada');
                        });
                      }}
                    >
                      <Plus size={15} />
                      Crear instantánea
                    </button>
                  </div>
                  <p className="muted">
                    Conserva hasta 10 versiones de tu bóveda. Las instantáneas comparten el
                    almacenamiento de este navegador; exporta para tener una copia externa.
                  </p>
                  {snapshots.length ? (
                    <div className="snapshot-list">
                      {snapshots.map((snapshot) => (
                        <div key={snapshot.id}>
                          <History size={16} />
                          <span>
                            <strong>{new Date(snapshot.createdAt).toLocaleString('es-PE')}</strong>
                            <small>{snapshot.noteCount} notas</small>
                          </span>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                title: 'Restaurar instantánea',
                                text: 'Se reemplazará tu bóveda por esta versión. Guardaremos una instantánea del estado actual antes de restaurar.',
                                action: async () => {
                                  await flush();
                                  const restored = await restoreSnapshot(snapshot.id, vault);
                                  replace(restored);
                                  setSnapshots(await listSnapshots());
                                  notify('Instantánea restaurada');
                                },
                              })
                            }
                          >
                            Restaurar
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="soft-empty">Tu primera instantánea está a un clic.</div>
                  )}
                </section>
                <section className="settings-section">
                  <h2>
                    <Sun size={19} />
                    Apariencia
                  </h2>
                  <div className="appearance-row">
                    <div>
                      <strong>Un ambiente para concentrarte</strong>
                      <p className="muted">Elige la luz que acompaña a tus ideas.</p>
                    </div>
                    <div className="segmented-control">
                      <button
                        className={theme === 'light' ? 'selected' : ''}
                        onClick={() => setTheme('light')}
                      >
                        <Sun size={15} />
                        Claro
                      </button>
                      <button
                        className={theme === 'dark' ? 'selected' : ''}
                        onClick={() => setTheme('dark')}
                      >
                        <Moon size={15} />
                        Oscuro
                      </button>
                    </div>
                  </div>
                </section>
                <section className="settings-section">
                  <h2>
                    <Command size={19} />
                    Atajos de teclado
                  </h2>
                  <div className="shortcut-list">
                    <span>
                      Buscar y abrir notas<kbd>Ctrl / ⌘ + K</kbd>
                    </span>
                    <span>
                      Nueva nota<kbd>Ctrl / ⌘ + N</kbd>
                    </span>
                    <span>
                      Guardar cambios<kbd>Ctrl / ⌘ + S</kbd>
                    </span>
                  </div>
                </section>
                <div className="about-atlas">
                  <Compass size={22} />
                  <strong>Atlas</strong>
                  <span>v0.1.0 · Un lugar para pensar mejor.</span>
                </div>
              </>
            )}
          </main>

          {(page === 'library' || page === 'note') && showContext && (
            <aside className="context-panel">
              {page === 'library' ? (
                <>
                  <div className="context-heading">
                    <h2>El panorama completo</h2>
                    <button
                      className="tiny-button"
                      aria-label="Ayuda de Atlas"
                      onClick={() => setHelp(true)}
                    >
                      <CircleHelp size={15} />
                    </button>
                  </div>
                  <button
                    className="mini-graph-card"
                    onClick={() => go('graph')}
                    aria-label="Explorar grafo de conocimiento"
                  >
                    <div className="mini-graph-label">
                      <span>
                        <Network size={13} />
                        Tu universo de ideas
                      </span>
                      <ArrowUpRight size={14} />
                    </div>
                    <MiniGraph notes={activeNotes} />
                    <div className="mini-graph-footer">
                      <span>{graph.edges.length} conexiones que dan sentido</span>
                      <span className="live-dot" />
                    </div>
                  </button>
                  <div className="context-section">
                    <div className="context-section-title">
                      <h3>
                        <Star size={15} />A mano
                      </h3>
                      <span>FAVORITAS</span>
                    </div>
                    {activeNotes
                      .filter((note) => note.favorite)
                      .slice(0, 4)
                      .map((note) => (
                        <button
                          className="favorite-link"
                          key={note.id}
                          onClick={() => openNote(note.id)}
                        >
                          <span className={'favorite-dot ' + colorFor(note.folder)} />
                          <div>
                            <strong>{note.title}</strong>
                            <span>{note.folder}</span>
                          </div>
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                    {!activeNotes.some((note) => note.favorite) && (
                      <p className="muted tiny">Marca una nota con ★ para tenerla a mano.</p>
                    )}
                  </div>
                  <div className="context-section">
                    <div className="context-section-title">
                      <h3>
                        <Hash size={15} />
                        Hilos de pensamiento
                      </h3>
                    </div>
                    <div className="context-tags">
                      {tags.slice(0, 6).map(([tag, count]) => (
                        <button
                          key={tag}
                          onClick={() => {
                            setTagFilter(tag);
                            setFolderFilter('');
                            setFilter('all');
                          }}
                        >
                          <span>#{tag}</span>
                          <span>{count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="thought-card">
                    <span className="quote-mark" aria-hidden="true">
                      “
                    </span>
                    <p>El conocimiento crece cuando las ideas se encuentran.</p>
                    <span>DALE ESPACIO A LA CURIOSIDAD</span>
                    <Sparkles size={19} />
                  </div>
                  <button className="context-help" onClick={() => setHelp(true)}>
                    <CircleHelp size={15} />
                    <span>Un pequeño recorrido por Atlas</span>
                    <ArrowRight size={14} />
                  </button>
                </>
              ) : (
                activeNote && (
                  <>
                    <div className="context-heading">
                      <h2>Conexiones de esta nota</h2>
                      <Link2 size={16} />
                    </div>
                    <div className="context-section">
                      <div className="context-section-title">
                        <h3>Enlaces salientes</h3>
                        <span>{outgoing.length}</span>
                      </div>
                      {outgoing.map((link, index) => (
                        <button
                          className="connection-link"
                          key={String(link) + index}
                          onClick={() =>
                            navigateTitle(typeof link === 'string' ? link : String(link))
                          }
                        >
                          <Link2 size={14} />
                          <span>{typeof link === 'string' ? link : String(link)}</span>
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                      {!outgoing.length && (
                        <p className="context-empty">
                          Escribe <code>[[Título]]</code> para conectar esta nota con otra.
                        </p>
                      )}
                    </div>
                    <div className="context-section">
                      <div className="context-section-title">
                        <h3>Enlaces entrantes</h3>
                        <span>{backlinks.length}</span>
                      </div>
                      {backlinks.map((note) => (
                        <button
                          className="connection-link"
                          key={note.id}
                          onClick={() => openNote(note.id)}
                        >
                          <FileText size={14} />
                          <span>{note.title}</span>
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                      {!backlinks.length && (
                        <p className="context-empty">
                          Las notas que enlacen a esta aparecerán aquí.
                        </p>
                      )}
                    </div>
                    <div className="context-section">
                      <div className="context-section-title">
                        <h3>En esta nota</h3>
                      </div>
                      {activeNote.content
                        .split('\n')
                        .filter((line) => /^#{1,6}\s/.test(line))
                        .map((line, index) => (
                          <button
                            className={
                              'outline-link outline-level-' + (line.match(/^#+/)?.[0].length ?? 1)
                            }
                            key={index}
                            onClick={() => {
                              setEditorMode('read');
                              requestAnimationFrame(() => {
                                const headings = document.querySelectorAll(
                                  '.reading-pane h1,.reading-pane h2,.reading-pane h3,.reading-pane h4,.reading-pane h5,.reading-pane h6',
                                );
                                Array.from(headings)
                                  .find(
                                    (heading) => heading.textContent === line.replace(/^#+\s/, ''),
                                  )
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              });
                            }}
                          >
                            {line.replace(/^#+\s/, '')}
                          </button>
                        ))}
                    </div>
                    <div className="note-info">
                      <span>
                        Creada <strong>{shortDate(activeNote.createdAt)}</strong>
                      </span>
                      <span>
                        Palabras <strong>{countWords(activeNote.content)}</strong>
                      </span>
                      <span>
                        Tiempo de lectura{' '}
                        <strong>
                          {Math.max(1, Math.ceil(countWords(activeNote.content) / 200))} min
                        </strong>
                      </span>
                    </div>
                    <button className="context-help" onClick={() => go('graph')}>
                      <Network size={15} />
                      <span>Explorar en el grafo</span>
                      <ArrowRight size={14} />
                    </button>
                  </>
                )
              )}
            </aside>
          )}
        </div>
      </div>
      <input
        ref={importInput}
        type="file"
        className="sr-only"
        aria-label="Archivos a importar"
        multiple
        accept=".md,.markdown,.txt,.zip,.json"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void importSelected(files);
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <span>
            <Bell size={16} />
            {toast}
          </span>
          <button
            aria-label="Cerrar notificación"
            className="tiny-button"
            onClick={() => setToast('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="operation-indicator" role="status">
          <LoaderCircle className="spin" size={18} />
          Procesando tus archivos…
        </div>
      )}

      {createDialog && (
        <Dialog title="Una nueva idea" onClose={closeCreate}>
          <form onSubmit={submitNote}>
            <p className="dialog-description">Empieza con un título. Lo demás irá tomando forma.</p>
            <label className="field-label" htmlFor="note-name">
              Título de la nota
            </label>
            <input
              id="note-name"
              className="form-input"
              required
              maxLength={200}
              placeholder="¿En qué estás pensando?"
              value={createDialog.title}
              onChange={(event) => setCreateDialog({ ...createDialog, title: event.target.value })}
            />
            <label className="field-label" htmlFor="note-folder">
              Carpeta
            </label>
            <input
              id="note-folder"
              className="form-input"
              list="folder-options"
              required
              value={createDialog.folder}
              onChange={(event) => setCreateDialog({ ...createDialog, folder: event.target.value })}
            />
            <datalist id="folder-options">
              {folders.map((folder) => (
                <option key={folder} value={folder} />
              ))}
            </datalist>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={closeCreate}>
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                <FilePlus2 size={16} />
                Crear nota
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {folderDialog && (
        <Dialog
          title="Un lugar para organizarte"
          onClose={() => {
            setFolderDialog(false);
            setFormError('');
          }}
        >
          <form onSubmit={createFolder}>
            <p className="dialog-description">Agrupa tus notas sin perder sus conexiones.</p>
            <label className="field-label" htmlFor="folder-name">
              Nombre de la carpeta
            </label>
            <input
              id="folder-name"
              className="form-input"
              required
              maxLength={100}
              placeholder="Ej. Ideas de producto"
              value={newFolder}
              onChange={(event) => setNewFolder(event.target.value)}
            />
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setFolderDialog(false)}
              >
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                <FolderPlus size={16} />
                Crear carpeta
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {searchDialog && (
        <Dialog title="Encuentra tu próxima conexión" onClose={closeSearch} wide>
          <div className="command-input">
            <Search size={21} />
            <input
              aria-label="Buscar notas"
              placeholder="Busca en títulos, contenido y etiquetas…"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="command-hints">
            <span>
              Prueba <code>tag:lectura</code> · <code>folder:Proyectos</code> ·{' '}
              <code>is:favorite</code>
            </span>
          </div>
          <div className="command-results">
            {searchNotes(notes, commandQuery)
              .slice(0, 15)
              .map((note) => (
                <button key={note.id} onClick={() => openNote(note.id)}>
                  <span className={'note-icon ' + colorFor(note.folder)}>
                    <FileText size={17} />
                  </span>
                  <span>
                    <strong>{note.title}</strong>
                    <small>
                      {note.folder} · {snippet(note.content).slice(0, 65)}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            {!searchNotes(notes, commandQuery).length && (
              <div className="soft-empty">No hay notas que coincidan. Prueba otra búsqueda.</div>
            )}
          </div>
          <div className="command-footer">
            <span>
              <Command size={12} />
              Un atajo hacia tus ideas
            </span>
            <button
              className="text-button"
              onClick={() => {
                closeSearch();
                setCreateDialog({ title: commandQuery, folder: 'Notas', content: '' });
              }}
            >
              <Plus size={14} />
              Nueva nota
            </button>
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="dialog-description">{confirm.text}</p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={() => setConfirm(null)}>
              Cancelar
            </button>
            <button
              className={confirm.danger ? 'danger-button' : 'primary-button'}
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                void runOperation(async () => {
                  await action();
                });
              }}
            >
              {confirm.danger ? 'Eliminar definitivamente' : 'Restaurar'}
            </button>
          </div>
        </Dialog>
      )}
      {help && (
        <Dialog title="Bienvenido a tu segundo cerebro" onClose={() => setHelp(false)} wide>
          <p className="dialog-description">
            Atlas es un lugar tranquilo para capturar ideas y dejar que se conecten.
          </p>
          <div className="help-steps">
            <div>
              <span className="stat-icon purple">
                <Pencil size={18} />
              </span>
              <div>
                <h3>Captura sin fricción</h3>
                <p>
                  Crea notas y escribe con Markdown. Usa títulos, listas, tablas, código y tareas.
                </p>
              </div>
            </div>
            <div>
              <span className="stat-icon sage">
                <Link2 size={18} />
              </span>
              <div>
                <h3>Piensa en conexiones</h3>
                <p>
                  Escribe [[Título de una nota]] para enlazar ideas. Explora relaciones y enlaces
                  entrantes en el grafo.
                </p>
              </div>
            </div>
            <div>
              <span className="stat-icon amber">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h3>Cuida lo que construyes</h3>
                <p>
                  Tu bóveda vive en este navegador. En Ajustes puedes exportar Markdown, importar
                  notas y guardar instantáneas.
                </p>
              </div>
            </div>
          </div>
          <div className="dialog-actions">
            <button className="primary-button" onClick={() => setHelp(false)}>
              Empezar a explorar
              <ArrowRight size={16} />
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function MiniGraph({ notes }: { notes: Note[] }) {
  const graph = useMemo(() => getGraphData(notes), [notes]);
  const degrees = new Map<string, number>();
  graph.edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  });
  const colors: Record<string, string> = {
    purple: '#a28bc9',
    sage: '#8fa897',
    amber: '#c7ae74',
    blue: '#91b0ca',
    rose: '#c28eaa',
  };
  const points = [...graph.nodes]
    .sort((a, b) => (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0))
    .slice(0, 24)
    .map((node, index, selected) => {
      const angle = ((index - 1) * Math.PI * 2) / Math.max(1, selected.length - 1) - Math.PI / 2;
      const radius = index % 3 === 0 ? 75 : 63;
      return {
        ...node,
        x: index === 0 ? 130 : 130 + Math.cos(angle) * radius * 1.35,
        y: index === 0 ? 89 : 89 + Math.sin(angle) * radius,
        size: index === 0 ? 8 : Math.min(6, 3 + Math.sqrt(degrees.get(node.id) ?? 0) / 2),
      };
    });
  const byId = new Map(points.map((point) => [point.id, point]));
  return (
    <svg className="mini-graph" viewBox="0 0 260 192" aria-hidden="true">
      <defs>
        <radialGradient id="graph-glow">
          <stop stopColor="#e9e2fb" stopOpacity=".8" />
          <stop offset="1" stopColor="#faf9ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="130" cy="96" r="92" fill="url(#graph-glow)" />
      {graph.edges.map((edge, index) => {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        return source && target ? (
          <line
            key={index}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
            stroke="#dcd4ec"
            strokeWidth=".8"
            opacity=".8"
          />
        ) : null;
      })}
      {points.map((point, index) => (
        <g key={point.id}>
          <circle
            cx={point.x}
            cy={point.y}
            r={point.size + 5}
            fill={index === 0 ? '#ebe4fa' : 'transparent'}
          />
          <circle
            cx={point.x}
            cy={point.y}
            r={point.size}
            fill={colors[colorFor(point.folder)]}
            stroke="white"
            strokeWidth="2"
          />
        </g>
      ))}
      <text x="130" y={points.length ? 115 : 96} textAnchor="middle" fill="#645574" fontSize="8.5">
        {points.length ? points[0].title.slice(0, 28) : 'Tu primera idea empieza aquí'}
      </text>
    </svg>
  );
}
