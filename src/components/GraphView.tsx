import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LocateFixed, Minus, Plus, Search } from 'lucide-react';
import { getGraphData, normalizeTitle, type Note } from '../lib/vault';

export interface GraphViewProps {
  notes: Note[];
  activeId?: string;
  onSelect: (id: string) => void;
}

interface Point {
  x: number;
  y: number;
}
interface PositionedNode extends Point {
  id: string;
  title: string;
  folder: string;
  degree: number;
}

const WIDTH = 1000;
const HEIGHT = 620;
const COLORS = ['#9a88c3', '#88a99a', '#d1ac71', '#7e9eba', '#c78f9f'];

function seed(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) >>> 0;
  return result;
}

function layout(
  nodes: { id: string; title: string; folder: string }[],
  edges: { source: string; target: string }[],
): PositionedNode[] {
  const degrees = new Map<string, number>();
  edges.forEach(({ source, target }) => {
    degrees.set(source, (degrees.get(source) ?? 0) + 1);
    degrees.set(target, (degrees.get(target) ?? 0) + 1);
  });
  const result = [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node, index) => {
      const angle = index * 2.399963229728653 + (seed(node.id) % 30) / 100;
      const radius =
        nodes.length === 1 ? 0 : 80 + Math.sqrt((index + 1) / Math.max(nodes.length, 1)) * 170;
      return {
        ...node,
        x: WIDTH / 2 + Math.cos(angle) * radius * 1.35,
        y: HEIGHT / 2 + Math.sin(angle) * radius * 0.9,
        degree: degrees.get(node.id) ?? 0,
      };
    });
  const byId = new Map(result.map((node) => [node.id, node]));

  // Bound quadratic work for large vaults; the deterministic radial layout remains useful.
  if (result.length > 220) return result;
  for (let iteration = 0; iteration < 72; iteration += 1) {
    const force = result.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const dx = result[i].x - result[j].x;
        const dy = result[i].y - result[j].y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const strength = Math.min(760 / (distance * distance), 2.6);
        force[i].x += (dx / distance) * strength;
        force[i].y += (dy / distance) * strength;
        force[j].x -= (dx / distance) * strength;
        force[j].y -= (dy / distance) * strength;
      }
    }
    const indexById = new Map(result.map((node, index) => [node.id, index]));
    for (const edge of edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const strength = (distance - 170) * 0.018;
      const i = indexById.get(source.id)!;
      const j = indexById.get(target.id)!;
      force[i].x += (dx / distance) * strength;
      force[i].y += (dy / distance) * strength;
      force[j].x -= (dx / distance) * strength;
      force[j].y -= (dy / distance) * strength;
    }
    result.forEach((node, index) => {
      node.x = Math.min(
        WIDTH - 130,
        Math.max(130, node.x + force[index].x + (WIDTH / 2 - node.x) * 0.001),
      );
      node.y = Math.min(
        HEIGHT - 70,
        Math.max(70, node.y + force[index].y + (HEIGHT / 2 - node.y) * 0.001),
      );
    });
  }
  return result;
}

export function GraphView({ notes, activeId, onSelect }: GraphViewProps) {
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointer: number; origin: Point; pan: Point } | null>(null);
  const graph = useMemo(() => getGraphData(notes), [notes]);
  const nodes = useMemo(() => layout(graph.nodes, graph.edges), [graph]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const folders = useMemo(() => [...new Set(nodes.map((node) => node.folder))].sort(), [nodes]);
  const folderColor = (folder: string) =>
    COLORS[Math.max(0, folders.indexOf(folder)) % COLORS.length];
  const normalizedQuery = normalizeTitle(query);
  const matches = (node: PositionedNode) =>
    !normalizedQuery || normalizeTitle(`${node.title} ${node.folder}`).includes(normalizedQuery);
  const matchingNodes = nodes.filter(matches);
  const activeNeighbors = useMemo(() => {
    const ids = new Set(activeId ? [activeId] : []);
    graph.edges.forEach(({ source, target }) => {
      if (source === activeId) ids.add(target);
      if (target === activeId) ids.add(source);
    });
    return ids;
  }, [graph.edges, activeId]);

  function viewportPoint(clientX: number, clientY: number): Point {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: WIDTH / 2, y: HEIGHT / 2 };
    const scale = Math.min(rect.width / WIDTH, rect.height / HEIGHT) || 1;
    return {
      x: (clientX - rect.left - (rect.width - WIDTH * scale) / 2) / scale,
      y: (clientY - rect.top - (rect.height - HEIGHT * scale) / 2) / scale,
    };
  }

  function changeZoom(multiplier: number, point = { x: WIDTH / 2, y: HEIGHT / 2 }) {
    const nextZoom = Math.max(0.45, Math.min(2.8, zoom * multiplier));
    const ratio = nextZoom / zoom;
    setPan({ x: point.x - (point.x - pan.x) * ratio, y: point.y - (point.y - pan.y) * ratio });
    setZoom(nextZoom);
  }

  function startDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest('[data-graph-node]')) return;
    dragRef.current = {
      pointer: event.pointerId,
      origin: viewportPoint(event.clientX, event.clientY),
      pan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointer !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <section className="graph-view" aria-label="Grafo de conocimiento">
      <div className="graph-toolbar">
        <div className="graph-heading">
          <span className="eyebrow">TU CONOCIMIENTO, CONECTADO</span>
          <h1>Vista de grafo</h1>
          <p>Las ideas crecen cuando se conectan.</p>
        </div>
        <label className="graph-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Buscar notas en el grafo"
            placeholder="Buscar en el grafo…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="graph-canvas">
        {nodes.length === 0 ? (
          <div className="graph-empty">
            <h2>Todo empieza con una idea</h2>
            <p>Crea una nota y usa [[enlaces]] para conectar tu conocimiento.</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className={`graph-svg${dragging ? ' is-dragging' : ''}`}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="group"
            aria-label={`${nodes.length} notas y ${graph.edges.length} conexiones. Selecciona una nota para abrirla.`}
            onPointerDown={startDrag}
            onPointerMove={(event) => {
              if (dragRef.current?.pointer !== event.pointerId) return;
              const point = viewportPoint(event.clientX, event.clientY);
              setPan({
                x: dragRef.current.pan.x + point.x - dragRef.current.origin.x,
                y: dragRef.current.pan.y + point.y - dragRef.current.origin.y,
              });
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              changeZoom(
                event.deltaY < 0 ? 1.1 : 1 / 1.1,
                viewportPoint(event.clientX, event.clientY),
              );
            }}
          >
            <defs>
              <pattern id="graph-dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#e7e5e0" />
              </pattern>
            </defs>
            <rect width={WIDTH} height={HEIGHT} fill="url(#graph-dot-grid)" />
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              <g className="graph-edges" aria-hidden="true">
                {graph.edges.map((edge, index) => {
                  const source = byId.get(edge.source);
                  const target = byId.get(edge.target);
                  if (!source || !target) return null;
                  const highlighted = edge.source === activeId || edge.target === activeId;
                  return (
                    <line
                      key={`${edge.source}-${edge.target}-${index}`}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={highlighted ? '#baaed1' : '#dedbd5'}
                      strokeWidth={highlighted ? 1.8 : 1.25}
                      opacity={matches(source) && matches(target) ? 0.9 : 0.17}
                    />
                  );
                })}
              </g>
              {nodes.map((node) => {
                const selected = node.id === activeId;
                const color = folderColor(node.folder);
                const radius = Math.min(11, 5.5 + Math.sqrt(node.degree) * 1.5);
                const visible = matches(node);
                return (
                  <g
                    key={node.id}
                    data-graph-node="true"
                    className={`graph-node${selected ? ' is-active' : ''}${activeNeighbors.has(node.id) ? ' is-connected' : ''}`}
                    transform={`translate(${node.x} ${node.y})`}
                    opacity={visible ? 1 : 0.18}
                    role="button"
                    tabIndex={visible ? 0 : -1}
                    aria-label={`Abrir ${node.title}, ${node.degree} conexiones`}
                    aria-pressed={selected}
                    onClick={() => onSelect(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(node.id);
                      }
                    }}
                  >
                    <title>{`${node.title} · ${node.folder || 'Sin carpeta'}`}</title>
                    <circle className="graph-node-hitbox" r="24" fill="transparent" />
                    {selected && <circle r={radius + 8} fill={color} opacity="0.12" />}
                    <circle
                      className="graph-node-dot"
                      r={radius}
                      fill={color}
                      stroke={selected ? '#fff' : color}
                      strokeWidth={selected ? 2 : 1}
                    />
                    <text
                      className="graph-node-label"
                      y={radius + 19}
                      textAnchor="middle"
                      fill={selected ? '#4f416a' : '#77736b'}
                      fontSize="11"
                      fontWeight={selected ? 600 : 400}
                    >
                      {node.title.length > 29 ? `${node.title.slice(0, 28)}…` : node.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        {normalizedQuery && matchingNodes.length === 0 && nodes.length > 0 && (
          <div className="graph-no-results" role="status">
            No se encontraron notas con «{query}».
          </div>
        )}
        <div className="graph-controls" aria-label="Controles del grafo">
          <button
            type="button"
            title="Acercar"
            aria-label="Acercar grafo"
            onClick={() => changeZoom(1.2)}
            disabled={zoom >= 2.8}
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            title="Alejar"
            aria-label="Alejar grafo"
            onClick={() => changeZoom(1 / 1.2)}
            disabled={zoom <= 0.45}
          >
            <Minus size={17} />
          </button>
          <span className="graph-control-divider" />
          <button
            type="button"
            title="Centrar"
            aria-label="Centrar grafo"
            onClick={() => {
              setPan({ x: 0, y: 0 });
              setZoom(1);
            }}
          >
            <LocateFixed size={17} />
          </button>
        </div>
      </div>
      <footer className="graph-footer">
        <div className="graph-legend">
          {folders.map((folder) => (
            <span key={folder}>
              <i style={{ backgroundColor: folderColor(folder) }} />
              {folder || 'Sin carpeta'}
            </span>
          ))}
        </div>
        <span className="graph-count">
          {normalizedQuery ? `${matchingNodes.length} de ${nodes.length}` : nodes.length} notas ·{' '}
          {graph.edges.length} conexiones
        </span>
        <p className="graph-hint">Arrastra para explorar · Selecciona una nota para abrirla</p>
      </footer>
    </section>
  );
}

export default GraphView;
