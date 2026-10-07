import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownView } from './MarkdownView';

function render(content: string, onToggleTask?: (line: number) => void) {
  return renderToStaticMarkup(
    <MarkdownView content={content} onNavigate={vi.fn()} onToggleTask={onToggleTask} />,
  );
}

describe('MarkdownView', () => {
  it('renders headings, lists, quotes, tables, and fenced code', () => {
    const html = render(
      '# Título\n\n**Una idea**\n\n- Elemento\n\n> Cita\n\n| Nota | Estado |\n| --- | --- |\n| Uno | Listo |\n\n```ts\nconst valor = 1\n```',
    );
    expect(html).toContain('<h1>Título</h1>');
    expect(html).toContain('<strong>Una idea</strong>');
    expect(html).toContain('<li>Elemento</li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('class="markdown-table-scroll"');
    expect(html).toContain('<td>Listo</td>');
    expect(html).toContain('class="language-ts"');
  });

  it('turns wikilinks and aliases into buttons while keeping code literal', () => {
    const html = render(
      '[[Mapa de ideas]] y [[Proyecto#Diseño|Mi proyecto]]\n\n`[[Código literal]]`\n\n```md\n[[Bloque literal]]\n```',
    );
    expect(html.match(/class="wiki-link"/g)).toHaveLength(2);
    expect(html).toContain('>Mapa de ideas</button>');
    expect(html).toContain('>Mi proyecto</button>');
    expect(html).toContain('<code>[[Código literal]]</code>');
    expect(html).toContain('[[Bloque literal]]');
    expect(html).not.toContain('href="wikilink:');
  });

  it('does not nest wiki buttons inside an existing Markdown link', () => {
    const html = render('[[Destino|Alias]] y [texto [[literal]]](https://example.com)');
    expect(html.match(/class="wiki-link"/g)).toHaveLength(1);
    expect(html).toContain('>texto [[literal]]</a>');
  });

  it('ignores raw HTML rather than inserting executable markup', () => {
    const html = render(
      '<script>alert("x")</script>\n\n<img src="x" onerror="alert(1)">\n\nTexto seguro',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toContain('Texto seguro');
  });

  it('blocks JavaScript, data links, and protocol-relative destinations', () => {
    const html = render(
      '[malicioso](javascript:alert%281%29)\n\n[datos](data:text/html;base64,PHNjcmlwdD4=)\n\n[externo](//example.com)',
    );
    expect(html).not.toContain('href=');
    expect(html.match(/markdown-invalid-link/g)).toHaveLength(3);
  });

  it('uses safe external links and preserves local heading links', () => {
    const html = render('[Documentación](https://example.com/docs) y [Sección](#una-seccion)');
    expect(html).toContain(
      'href="https://example.com/docs" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain('href="#una-seccion" rel="noopener noreferrer"');
  });

  it('allows raster data images and rejects SVG and JavaScript image sources', () => {
    const html = render(
      '![raster](data:image/png;base64,aGVsbG8=)\n\n![svg](data:image/svg+xml;base64,PHN2Zz4=)\n\n![script](javascript:alert%281%29)\n\n![https](https://example.com/image.png)',
    );
    expect(html).toContain('src="data:image/png;base64,aGVsbG8="');
    expect(html).toContain('src="https://example.com/image.png"');
    expect(html).not.toContain('src="data:image/svg');
    expect(html).not.toContain('src="javascript:');
    expect(html.match(/markdown-image-fallback/g)).toHaveLength(2);
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
  });

  it('enables read-view checkboxes and keeps their original zero-based line numbers', () => {
    const html = render(
      '# Tareas\n\nUna introducción.\n\n- [ ] Pendiente\n- [x] Terminada\n  - [ ] Anidada',
      vi.fn(),
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain('disabled=');
    expect(html).toContain('data-task-line="4"');
    expect(html).toContain('data-task-line="5"');
    expect(html).toContain('data-task-line="6"');
    expect(html).toContain('aria-label="Completar: Pendiente"');
    expect(html).toContain('checked=""');
  });

  it('keeps checkboxes read-only when no task callback is supplied', () => {
    const html = render('- [ ] Solo lectura');
    expect(html).toContain('disabled=""');
    expect(html).toContain('data-task-line="0"');
  });
});
