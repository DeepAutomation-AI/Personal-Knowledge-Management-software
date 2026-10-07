import { createContext, useContext, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface MarkdownViewProps {
  content: string;
  onNavigate: (title: string) => void;
  /** Zero-based line in the original Markdown document. */
  onToggleTask?: (line: number) => void;
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

const WIKI_SCHEME = 'wikilink:';

/** Work on text nodes so fenced code, inline code, and existing links stay literal. */
function remarkWikiLinks() {
  return (tree: MarkdownNode) => {
    function transform(parent: MarkdownNode) {
      if (!parent.children || ['link', 'image', 'code', 'inlineCode'].includes(parent.type)) return;

      parent.children = parent.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          transform(child);
          return [child];
        }

        const pattern = /\[\[([^\]\n]+)\]\]/g;
        const nodes: MarkdownNode[] = [];
        let cursor = 0;
        for (const match of child.value.matchAll(pattern)) {
          const index = match.index ?? 0;
          if (index > cursor) nodes.push({ type: 'text', value: child.value.slice(cursor, index) });
          const [destination, ...aliasParts] = match[1].split('|');
          const title = destination.split('#')[0].trim();
          if (!title) {
            nodes.push({ type: 'text', value: match[0] });
          } else {
            nodes.push({
              type: 'link',
              url: `${WIKI_SCHEME}${encodeURIComponent(title)}`,
              children: [
                { type: 'text', value: aliasParts.join('|').trim() || destination.trim() },
              ],
            });
          }
          cursor = index + match[0].length;
        }
        if (cursor === 0) return [child];
        if (cursor < child.value.length)
          nodes.push({ type: 'text', value: child.value.slice(cursor) });
        return nodes;
      });
    }
    transform(tree);
  };
}

function safeLink(url: string): boolean {
  const compact = url.trim().replace(/[\u0000-\u0020\u007f]/g, '');
  return (
    /^(?:https?:|mailto:|tel:)/i.test(compact) ||
    (!/^[a-z][a-z\d+.-]*:/i.test(compact) && !compact.startsWith('//'))
  );
}

function safeImage(url: string): boolean {
  const compact = url.trim().replace(/[\u0000-\u0020\u007f]/g, '');
  if (/^data:/i.test(compact))
    return /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(compact);
  if (/^blob:/i.test(compact)) return true;
  return (
    /^(?:https?:)/i.test(compact) ||
    (!/^[a-z][a-z\d+.-]*:/i.test(compact) && !compact.startsWith('//'))
  );
}

const TaskContext = createContext<{ line: number; label: string }>({ line: -1, label: 'tarea' });

function nodeText(node: { type?: string; value?: string; children?: unknown[] }): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? [])
    .map((child) => nodeText(child as Parameters<typeof nodeText>[0]))
    .join('');
}

function TaskCheckbox({ checked, toggle }: { checked: boolean; toggle?: (line: number) => void }) {
  const { line, label } = useContext(TaskContext);
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={!toggle || line < 0}
      data-task-line={line >= 0 ? line : undefined}
      onChange={() => {
        if (line >= 0) toggle?.(line);
      }}
      aria-label={`${checked ? 'Marcar como pendiente' : 'Completar'}: ${label}`}
    />
  );
}

export function MarkdownView({ content, onNavigate, onToggleTask }: MarkdownViewProps) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children, ...props }) {
        if (href?.startsWith(WIKI_SCHEME)) {
          let title: string;
          try {
            title = decodeURIComponent(href.slice(WIKI_SCHEME.length));
          } catch {
            return <span>{children}</span>;
          }
          return (
            <button type="button" className="wiki-link" onClick={() => onNavigate(title)}>
              {children}
            </button>
          );
        }
        const { node: _node, ...anchorProps } = props;
        if (!href || !safeLink(href))
          return <span className="markdown-invalid-link">{children}</span>;
        return (
          <a
            {...anchorProps}
            href={href}
            target={href.startsWith('#') ? undefined : '_blank'}
            rel="noopener noreferrer"
          >
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        if (!src || !safeImage(src))
          return <span className="markdown-image-fallback">{alt || 'Imagen no disponible'}</span>;
        return (
          <img
            src={src}
            alt={alt || ''}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.classList.add('markdown-image-error');
              event.currentTarget.alt = alt || 'No se pudo cargar la imagen';
            }}
          />
        );
      },
      li({ node, children, className, ...props }) {
        const line = node?.position?.start.line;
        return (
          <TaskContext.Provider
            value={{
              line: line === undefined ? -1 : line - 1,
              label: node ? nodeText(node).trim() || 'tarea' : 'tarea',
            }}
          >
            <li {...props} className={className}>
              {children}
            </li>
          </TaskContext.Provider>
        );
      },
      input({ type, checked }) {
        return type === 'checkbox' ? (
          <TaskCheckbox checked={Boolean(checked)} toggle={onToggleTask} />
        ) : null;
      },
      table({ children }) {
        return (
          <div className="markdown-table-scroll">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [onNavigate, onToggleTask],
  );

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkWikiLinks]}
        components={components}
        skipHtml
        urlTransform={(url, key) => {
          if (key === 'href' && url.startsWith(WIKI_SCHEME)) return url;
          return (key === 'src' ? safeImage(url) : safeLink(url)) ? url : '';
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownView;
