import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PipelineJob, PipelineTaskDetail } from '@shared/types';

const SUPPORTED_REGIONS = ['us-west1', 'us-central1', 'us-east1', 'asia-northeast1'];
const PAGE_SIZE = 20;

const PIPELINE_STATUS_EMOJI: Record<string, string> = {
  UNSPECIFIED: '\u{1F914}',
  QUEUED: '\u{23F3}',
  PENDING: '\u{23F1}\uFE0F',
  RUNNING: '\u{1F3C3}\u{1F4A8}',
  SUCCEEDED: '\u{2705}',
  FAILED: '\u{274C}',
  CANCELLING: '\u{1F6D1}',
  CANCELLED: '\u{1F6AB}',
  PAUSED: '\u{23F8}\uFE0F',
};

const TASK_STATUS_EMOJI: Record<string, string> = {
  NOT_STARTED: '\u{26AA}',
  PENDING: '\u{23F1}\uFE0F',
  RUNNING: '\u{1F535}',
  SUCCEEDED: '\u{2705}',
  FAILED: '\u{274C}',
  SKIPPED: '\u{23ED}\uFE0F',
  CANCELLED: '\u{1F6AB}',
  CANCELLING: '\u{1F6D1}',
};

const ACTIVE_STATES = new Set(['QUEUED', 'PENDING', 'RUNNING']);

function formatTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
}

function formatDuration(start?: string, end?: string): string {
  if (!start) return '-';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (isNaN(s)) return '-';
  const diff = Math.max(0, e - s);
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function pipelineJobId(name: string): string {
  const parts = name.split('/');
  return parts[parts.length - 1] ?? name;
}

function consoleUrl(job: PipelineJob, projectId: string): string {
  const id = pipelineJobId(job.name);
  return `https://console.cloud.google.com/vertex-ai/locations/${job.region}/pipelines/runs/${id}?project=${projectId}`;
}

function logsUrl(job: PipelineJob, projectId: string): string {
  const id = pipelineJobId(job.name);
  let ts = '';
  if (job.createTime) {
    ts = `%20timestamp%3E%3D%22${encodeURIComponent(job.createTime)}%22`;
  }
  const query = `resource.labels.pipeline_job_id%3D%22${id}%22${ts}`;
  return `https://console.cloud.google.com/logs/query;query=${query}?project=${projectId}`;
}

function nodeLogsUrl(job: PipelineJob, task: PipelineTaskDetail, projectId: string): string {
  const id = pipelineJobId(job.name);
  let ts = '';
  if (task.createTime) {
    ts = `%20timestamp%3E%3D%22${encodeURIComponent(task.createTime)}%22`;
  }
  const query = `resource.labels.pipeline_job_id%3D%22${id}%22%20%22${encodeURIComponent(task.taskName)}%22${ts}`;
  return `https://console.cloud.google.com/logs/query;query=${query}?project=${projectId}`;
}

// ── DAG Layout ──────────────────────────────────────────────────────────

type DagNode = PipelineTaskDetail & { x: number; y: number; depth: number; children: string[] };

const NODE_W = 220;
const NODE_H = 72;
const H_GAP = 40;
const V_GAP = 80;

function stateColor(state: string): string {
  switch (state) {
    case 'SUCCEEDED': return '#16a34a';
    case 'FAILED': return '#dc2626';
    case 'RUNNING': return '#2563eb';
    case 'PENDING': case 'NOT_STARTED': return '#d97706';
    case 'SKIPPED': return '#9ca3af';
    case 'CANCELLED': case 'CANCELLING': return '#6b7280';
    default: return '#6b7280';
  }
}

function buildDag(tasks: PipelineTaskDetail[]): { nodes: Map<string, DagNode>; width: number; height: number } {
  const nodes = new Map<string, DagNode>();
  const childMap = new Map<string, string[]>();

  for (const t of tasks) {
    const node: DagNode = { ...t, x: 0, y: 0, depth: 0, children: [] };
    nodes.set(t.taskId, node);
    if (!childMap.has(t.taskId)) childMap.set(t.taskId, []);
  }
  for (const t of tasks) {
    if (t.parentTaskId && childMap.has(t.parentTaskId)) {
      childMap.get(t.parentTaskId)!.push(t.taskId);
    }
  }
  for (const [id, children] of childMap) {
    const node = nodes.get(id);
    if (node) node.children = children;
  }

  const roots: string[] = [];
  for (const t of tasks) {
    if (!t.parentTaskId || !nodes.has(t.parentTaskId)) {
      roots.push(t.taskId);
    }
  }

  // BFS to assign depth (vertical levels, top-to-bottom)
  const queue = [...roots.map((id) => ({ id, depth: 0 }))];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    node.depth = depth;
    for (const childId of node.children) {
      if (!visited.has(childId)) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    }
  }

  // Group by depth (rows)
  const depthGroups = new Map<number, string[]>();
  for (const [id, node] of nodes) {
    if (!depthGroups.has(node.depth)) depthGroups.set(node.depth, []);
    depthGroups.get(node.depth)!.push(id);
  }

  // First pass: assign positions row by row, centering children under parent
  // Leaf-first (bottom-up) sizing then top-down placement
  const subtreeWidth = new Map<string, number>();

  function calcWidth(id: string): number {
    const node = nodes.get(id);
    if (!node || node.children.length === 0) {
      subtreeWidth.set(id, NODE_W);
      return NODE_W;
    }
    const childrenW = node.children.reduce((sum, cid) => sum + calcWidth(cid), 0)
      + (node.children.length - 1) * H_GAP;
    const w = Math.max(NODE_W, childrenW);
    subtreeWidth.set(id, w);
    return w;
  }

  // Calculate total width needed for root layer
  for (const r of roots) calcWidth(r);
  const totalRootsWidth = roots.reduce((s, r) => s + (subtreeWidth.get(r) ?? NODE_W), 0)
    + (roots.length - 1) * H_GAP;

  // Place nodes top-down
  function placeNode(id: string, centerX: number, depth: number) {
    const node = nodes.get(id);
    if (!node) return;
    node.x = centerX - NODE_W / 2;
    node.y = depth * (NODE_H + V_GAP);
    node.depth = depth;

    if (node.children.length === 0) return;
    const childrenTotalW = node.children.reduce((s, cid) => s + (subtreeWidth.get(cid) ?? NODE_W), 0)
      + (node.children.length - 1) * H_GAP;
    let cx = centerX - childrenTotalW / 2;
    for (const cid of node.children) {
      const cw = subtreeWidth.get(cid) ?? NODE_W;
      placeNode(cid, cx + cw / 2, depth + 1);
      cx += cw + H_GAP;
    }
  }

  let startX = 0;
  for (const r of roots) {
    const w = subtreeWidth.get(r) ?? NODE_W;
    placeNode(r, startX + w / 2, 0);
    startX += w + H_GAP;
  }

  // Normalize: shift so min x is 0
  let minX = Infinity;
  for (const n of nodes.values()) minX = Math.min(minX, n.x);
  if (minX < 0) {
    for (const n of nodes.values()) n.x -= minX;
  }

  let maxX = 0, maxY = 0;
  for (const n of nodes.values()) {
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + NODE_H);
  }

  return { nodes, width: maxX + 40, height: maxY + 40 };
}

// ── Status SVG Icons (12px) ─────────────────────────────────────────────

const StatusIcon: React.FC<{ state: string }> = ({ state }) => {
  const color = stateColor(state);
  const size = 12;
  if (state === 'SUCCEEDED') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="6" fill={color} />
        <path d="M3.5 6 L5.5 8 L8.5 4" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === 'FAILED') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="6" fill={color} />
        <path d="M4 4 L8 8 M8 4 L4 8" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === 'RUNNING') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" className="dag-spinner">
        <circle cx="6" cy="6" r="6" fill={color} />
        <path d="M6 2.5 A3.5 3.5 0 0 1 9.5 6" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  // Default: empty circle for pending/not_started/etc
  return (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5.5" fill="none" stroke={color} strokeWidth="1" />
      <circle cx="6" cy="6" r="3" fill={color} opacity="0.4" />
    </svg>
  );
};

// ── Minimap ─────────────────────────────────────────────────────────────

const DagMinimap: React.FC<{
  nodes: Map<string, DagNode>;
  dagWidth: number;
  dagHeight: number;
  pan: { x: number; y: number };
  zoom: number;
  containerWidth: number;
  containerHeight: number;
  onClickMinimap: (newPan: { x: number; y: number }) => void;
}> = ({ nodes, dagWidth, dagHeight, pan, zoom, containerWidth, containerHeight, onClickMinimap }) => {
  const mmW = 160;
  const mmH = 120;
  const padded = { w: Math.max(dagWidth, 400), h: Math.max(dagHeight, 300) };
  const scale = Math.min(mmW / padded.w, mmH / padded.h);

  // Viewport rect in DAG coords
  const vpX = -pan.x;
  const vpY = -pan.y;
  const vpW = containerWidth / zoom;
  const vpH = containerHeight / zoom;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / scale;
    const clickY = (e.clientY - rect.top) / scale;
    onClickMinimap({
      x: -(clickX - vpW / 2),
      y: -(clickY - vpH / 2),
    });
  };

  return (
    <div className="dag-minimap">
      <svg width={mmW} height={mmH} onClick={handleClick} style={{ cursor: 'pointer' }}>
        <rect width={mmW} height={mmH} fill="var(--bg)" opacity="0.9" rx="4" />
        <g transform={`scale(${scale})`}>
          {Array.from(nodes.values()).map((node) => (
            <rect
              key={node.taskId}
              x={node.x}
              y={node.y}
              width={NODE_W}
              height={NODE_H}
              rx={3}
              fill={stateColor(node.state)}
              opacity={0.7}
            />
          ))}
          <rect
            x={vpX}
            y={vpY}
            width={vpW}
            height={vpH}
            fill="var(--accent)"
            opacity={0.15}
            stroke="var(--accent)"
            strokeWidth={2 / scale}
            rx={2}
          />
        </g>
      </svg>
    </div>
  );
};

// ── Progress Bar ────────────────────────────────────────────────────────

const DagProgressBar: React.FC<{ tasks: PipelineTaskDetail[] }> = ({ tasks }) => {
  if (tasks.length === 0) return null;
  const completed = tasks.filter((t) => t.state === 'SUCCEEDED').length;
  return (
    <div className="dag-progress">
      <span className="dag-progress-label">{completed}/{tasks.length} steps completed</span>
      <div className="dag-progress-bar">
        {tasks.map((t, i) => (
          <div
            key={t.taskId}
            className="dag-progress-segment"
            style={{
              flex: 1,
              backgroundColor: stateColor(t.state),
              borderRadius: i === 0 ? '3px 0 0 3px' : i === tasks.length - 1 ? '0 3px 3px 0' : '0',
            }}
          />
        ))}
      </div>
    </div>
  );
};

// ── Pipeline DAG Component ──────────────────────────────────────────────

const PipelineDag: React.FC<{
  tasks: PipelineTaskDetail[];
  selectedTask: string | null;
  onSelectTask: (taskId: string | null) => void;
}> = ({ tasks, selectedTask, onSelectTask }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  const { nodes, width, height } = useMemo(() => buildDag(tasks), [tasks]);

  // Track container size for minimap viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(2, Math.max(0.3, z * delta)));
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.dag-node')) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x) / zoom,
        y: dragStart.current.panY + (e.clientY - dragStart.current.y) / zoom,
      });
    },
    [dragging, zoom]
  );

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleResetView = useCallback(() => {
    setPan({ x: 20, y: 20 });
    setZoom(1);
  }, []);

  const handleFitView = useCallback(() => {
    if (nodes.size === 0) return;
    const cw = containerSize.w;
    const ch = containerSize.h;
    const padX = 40;
    const padY = 40;
    const fitZoom = Math.min(
      (cw - padX * 2) / width,
      (ch - padY * 2) / height,
      1.5
    );
    const clampedZoom = Math.max(0.3, Math.min(2, fitZoom));
    setZoom(clampedZoom);
    // Center the DAG
    const dagVisW = width * clampedZoom;
    const dagVisH = height * clampedZoom;
    setPan({
      x: (cw - dagVisW) / (2 * clampedZoom),
      y: (ch - dagVisH) / (2 * clampedZoom),
    });
  }, [nodes.size, width, height, containerSize]);

  // Build edges
  const edges: { from: DagNode; to: DagNode }[] = [];
  for (const [, node] of nodes) {
    for (const childId of node.children) {
      const child = nodes.get(childId);
      if (child) edges.push({ from: node, to: child });
    }
  }

  if (tasks.length === 0) {
    return <div className="empty-state">No task details available for this pipeline.</div>;
  }

  return (
    <div className="dag-container">
      <div className="dag-controls">
        <button className="secondary-button dag-ctrl-btn" onClick={() => setZoom((z) => Math.min(2, z * 1.2))}>+</button>
        <button className="secondary-button dag-ctrl-btn" onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}>-</button>
        <button className="secondary-button dag-ctrl-btn" onClick={handleFitView}>Fit</button>
        <button className="secondary-button dag-ctrl-btn" onClick={handleResetView}>Reset</button>
        <span className="dag-zoom-label">{Math.round(zoom * 100)}%</span>
      </div>
      <DagMinimap
        nodes={nodes}
        dagWidth={width}
        dagHeight={height}
        pan={pan}
        zoom={zoom}
        containerWidth={containerSize.w}
        containerHeight={containerSize.h}
        onClickMinimap={setPan}
      />
      <div
        ref={containerRef}
        className="dag-canvas"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <svg
          width={Math.max(width * zoom + 400, containerSize.w)}
          height={Math.max(height * zoom + 200, containerSize.h)}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        >
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="var(--muted)" />
            </marker>
          </defs>
          <g transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}>
            {edges.map((edge, i) => {
              const x1 = edge.from.x + NODE_W / 2;
              const y1 = edge.from.y + NODE_H;
              const x2 = edge.to.x + NODE_W / 2;
              const y2 = edge.to.y;
              const cy1 = y1 + V_GAP * 0.4;
              const cy2 = y2 - V_GAP * 0.4;
              const parentDone = edge.from.state === 'SUCCEEDED';
              const edgeColor = parentDone ? stateColor(edge.from.state) : 'var(--border)';
              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;
              // Count artifacts on this edge (parent outputs + child inputs)
              const parentOutputCount = Object.keys(edge.from.outputs).length;
              const childInputCount = Object.keys(edge.to.inputs).length;
              const hasArtifacts = parentOutputCount > 0 || childInputCount > 0;
              return (
                <g key={i}>
                  <path
                    d={`M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={edgeColor}
                    strokeWidth={2}
                    opacity={parentDone ? 0.8 : 0.4}
                    markerEnd="url(#arrowhead)"
                  />
                  {hasArtifacts && (
                    <circle
                      cx={midX}
                      cy={midY}
                      r={3}
                      fill={edgeColor}
                      opacity={parentDone ? 0.9 : 0.5}
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: '0 0',
            position: 'relative',
          }}
        >
          {Array.from(nodes.values()).map((node) => {
            const artifactCount = Object.keys(node.inputs).length + Object.keys(node.outputs).length;
            return (
              <div
                key={node.taskId}
                className={`dag-node ${selectedTask === node.taskId ? 'selected' : ''}`}
                style={{
                  left: node.x + pan.x,
                  top: node.y + pan.y,
                  width: NODE_W,
                  height: NODE_H,
                  borderLeftColor: stateColor(node.state),
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTask(selectedTask === node.taskId ? null : node.taskId);
                }}
              >
                <div className="dag-node-status-badge">
                  <StatusIcon state={node.state} />
                </div>
                {artifactCount > 0 && (
                  <div className="dag-node-artifact-badge">{artifactCount}</div>
                )}
                <div className="dag-node-name">{node.taskName}</div>
                <div className="dag-node-meta">
                  <span className="dag-node-state" style={{ color: stateColor(node.state) }}>
                    {node.state}
                  </span>
                  <span className="dag-node-time">{formatDuration(node.startTime, node.endTime)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Right Panel with Tabs ───────────────────────────────────────────────

const PipelineSummaryPanel: React.FC<{ job: PipelineJob }> = ({ job }) => (
  <div className="pipe-summary-content">
    <div className="vai-detail-section">
      <h4>Overview</h4>
      <div className="vai-detail-grid">
        <span className="vai-detail-label">State</span>
        <span>{PIPELINE_STATUS_EMOJI[job.state] ?? ''} {job.state}</span>
        <span className="vai-detail-label">Region</span>
        <span>{job.region}</span>
        <span className="vai-detail-label">Created</span>
        <span>{formatTime(job.createTime)}</span>
        <span className="vai-detail-label">Started</span>
        <span>{formatTime(job.startTime)}</span>
        <span className="vai-detail-label">Ended</span>
        <span>{formatTime(job.endTime)}</span>
        <span className="vai-detail-label">Duration</span>
        <span>{formatDuration(job.startTime, job.endTime)}</span>
        {job.serviceAccount && (
          <>
            <span className="vai-detail-label">Service Account</span>
            <span className="vai-detail-mono" style={{ wordBreak: 'break-all' }}>{job.serviceAccount}</span>
          </>
        )}
        {job.network && (
          <>
            <span className="vai-detail-label">Network</span>
            <span className="vai-detail-mono" style={{ wordBreak: 'break-all' }}>{job.network}</span>
          </>
        )}
        {job.templateUri && (
          <>
            <span className="vai-detail-label">Template</span>
            <span className="vai-detail-mono" style={{ wordBreak: 'break-all' }}>{job.templateUri}</span>
          </>
        )}
      </div>
    </div>

    {job.labels && Object.keys(job.labels).length > 0 && (
      <div className="vai-detail-section">
        <h4>Labels</h4>
        <div className="vai-detail-grid">
          {Object.entries(job.labels).map(([k, v]) => (
            <React.Fragment key={k}>
              <span className="vai-detail-label">{k}</span>
              <span className="vai-detail-mono">{v}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    )}

    {job.runtimeConfig?.parameterValues && Object.keys(job.runtimeConfig.parameterValues).length > 0 && (
      <div className="vai-detail-section">
        <h4>Runtime Parameters</h4>
        <div className="vai-detail-grid">
          {Object.entries(job.runtimeConfig.parameterValues).map(([k, v]) => (
            <React.Fragment key={k}>
              <span className="vai-detail-label">{k}</span>
              <span className="vai-detail-mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    )}

    {job.runtimeConfig?.gcsOutputDirectory && (
      <div className="vai-detail-section">
        <h4>Output Directory</h4>
        <div className="vai-detail-mono" style={{ padding: '4px 0', wordBreak: 'break-all' }}>
          {job.runtimeConfig.gcsOutputDirectory}
        </div>
      </div>
    )}

    {job.error && (
      <div className="vai-detail-section">
        <h4>Error</h4>
        <div className="vai-msg vai-msg-err">{job.error.message}</div>
      </div>
    )}
  </div>
);

const NodeDetailPanel: React.FC<{ task: PipelineTaskDetail; job: PipelineJob; projectId: string }> = ({ task, job, projectId }) => (
  <div className="pipe-node-detail-content">
    <div className="vai-detail-section">
      <h4>Overview</h4>
      <div className="vai-detail-grid">
        <span className="vai-detail-label">State</span>
        <span>{TASK_STATUS_EMOJI[task.state] ?? ''} {task.state}</span>
        <span className="vai-detail-label">Task ID</span>
        <span className="vai-detail-mono">{task.taskId}</span>
        <span className="vai-detail-label">Created</span>
        <span>{formatTime(task.createTime)}</span>
        <span className="vai-detail-label">Started</span>
        <span>{formatTime(task.startTime)}</span>
        <span className="vai-detail-label">Ended</span>
        <span>{formatTime(task.endTime)}</span>
        <span className="vai-detail-label">Duration</span>
        <span>{formatDuration(task.startTime, task.endTime)}</span>
        {task.executionName && (
          <>
            <span className="vai-detail-label">Execution</span>
            <span className="vai-detail-mono">{task.executionName}</span>
          </>
        )}
      </div>
      <button
        className="vai-link-btn"
        style={{ marginTop: 8 }}
        onClick={() => window.shell.openExternal(nodeLogsUrl(job, task, projectId))}
      >
        Node Logs
      </button>
    </div>

    {task.error && (
      <div className="vai-detail-section">
        <h4>Error</h4>
        <div className="vai-msg vai-msg-err">{task.error.message}</div>
      </div>
    )}

    {Object.keys(task.inputs).length > 0 && (
      <div className="vai-detail-section">
        <h4>Inputs</h4>
        <div className="vai-detail-grid">
          {Object.entries(task.inputs).map(([k, uris]) => (
            <React.Fragment key={k}>
              <span className="vai-detail-label">{k}</span>
              <span className="vai-detail-mono">{uris.join(', ') || '(none)'}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    )}

    {Object.keys(task.outputs).length > 0 && (
      <div className="vai-detail-section">
        <h4>Outputs</h4>
        <div className="vai-detail-grid">
          {Object.entries(task.outputs).map(([k, uris]) => (
            <React.Fragment key={k}>
              <span className="vai-detail-label">{k}</span>
              <span className="vai-detail-mono">{uris.join(', ') || '(none)'}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    )}

    {task.pipelineTaskStatus && task.pipelineTaskStatus.length > 0 && (
      <div className="vai-detail-section">
        <h4>Status History</h4>
        <div className="pipe-status-timeline">
          {task.pipelineTaskStatus.map((s, i) => (
            <div key={i} className="pipe-status-entry">
              <span className="pipe-status-state">{TASK_STATUS_EMOJI[s.state] ?? ''} {s.state}</span>
              <span className="pipe-status-time">{formatTime(s.updateTime)}</span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);

type DetailPanelTab = 'summary' | 'node';

const DagDetailPanel: React.FC<{
  job: PipelineJob;
  projectId: string;
  selectedTask: PipelineTaskDetail | null;
  activeTab: DetailPanelTab;
  onTabChange: (tab: DetailPanelTab) => void;
}> = ({ job, projectId, selectedTask, activeTab, onTabChange }) => (
  <div className="pipe-detail-panel">
    <div className="pipe-detail-tabs">
      <button
        className={`pipe-detail-tab ${activeTab === 'summary' ? 'active' : ''}`}
        onClick={() => onTabChange('summary')}
      >
        Pipeline Summary
      </button>
      <button
        className={`pipe-detail-tab ${activeTab === 'node' ? 'active' : ''}`}
        onClick={() => onTabChange('node')}
        disabled={!selectedTask}
      >
        Node Details
      </button>
    </div>
    <div className="pipe-detail-tab-content">
      {activeTab === 'summary' && <PipelineSummaryPanel job={job} />}
      {activeTab === 'node' && selectedTask && <NodeDetailPanel task={selectedTask} job={job} projectId={projectId} />}
      {activeTab === 'node' && !selectedTask && (
        <div className="empty-state" style={{ padding: '24px' }}>Select a node in the DAG to view its details.</div>
      )}
    </div>
  </div>
);

// ── Main PipelinesTab ───────────────────────────────────────────────────

type ViewMode = 'list' | 'dag';

const PipelinesTab: React.FC<{ isActive?: boolean }> = () => {
  const [projectId, setProjectId] = useState('');
  const [projectInput, setProjectInput] = useState('');
  const [regions, setRegions] = useState<string[]>(['us-west1']);
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [pageTokens, setPageTokens] = useState<Record<string, string | undefined>>({});
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Pipeline detail view
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activePipeline, setActivePipeline] = useState<PipelineJob | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailPanelTab>('summary');

  useEffect(() => {
    (window as any).bq?.listProjects?.().then((res: any) => {
      if (res?.ok && res.data?.length > 0) {
        const first = res.data[0].id;
        setProjectId(first);
        setProjectInput(first);
      }
    });
  }, []);

  const fetchJobs = useCallback(async () => {
    if (!projectId || regions.length === 0) return;
    setLoading(true);
    setError('');
    setSelected(new Set());
    setPageTokens({});

    try {
      const results = await Promise.all(
        regions.map(async (region) => {
          const res = await window.pipelines.list({ projectId, region, pageSize: PAGE_SIZE });
          if (!res.ok) throw new Error(res.error);
          setPageTokens((prev) => ({ ...prev, [region]: res.data.nextPageToken }));
          return res.data.jobs;
        })
      );
      setJobs(results.flat());
    } catch (err: any) {
      setError(String(err));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, regions]);

  useEffect(() => {
    if (projectId) fetchJobs();
  }, [projectId, regions, fetchJobs]);

  const loadMore = useCallback(
    async (region: string) => {
      const token = pageTokens[region];
      if (!token) return;
      setLoadingMore(region);
      try {
        const res = await window.pipelines.list({
          projectId,
          region,
          pageSize: PAGE_SIZE,
          pageToken: token,
        });
        if (!res.ok) throw new Error(res.error);
        setJobs((prev) => [...prev, ...res.data.jobs]);
        setPageTokens((prev) => ({ ...prev, [region]: res.data.nextPageToken }));
      } catch (err: any) {
        setError(String(err));
      } finally {
        setLoadingMore(null);
      }
    },
    [projectId, pageTokens]
  );

  const openPipelineDetail = useCallback(
    async (job: PipelineJob) => {
      // If we already have task details, just show them
      if (job.taskDetails.length > 0) {
        setActivePipeline(job);
        setViewMode('dag');
        setSelectedTask(null);
        setDetailTab('summary');
        return;
      }
      // Otherwise fetch the full detail
      setLoadingDetail(true);
      try {
        const id = pipelineJobId(job.name);
        const res = await window.pipelines.get({ projectId, region: job.region, pipelineJobId: id });
        if (!res.ok) throw new Error(res.error);
        setActivePipeline(res.data);
        setViewMode('dag');
        setSelectedTask(null);
        setDetailTab('summary');
      } catch (err: any) {
        setError(String(err));
      } finally {
        setLoadingDetail(false);
      }
    },
    [projectId]
  );

  const refreshPipeline = useCallback(async () => {
    if (!activePipeline) return;
    try {
      const id = pipelineJobId(activePipeline.name);
      const res = await window.pipelines.get({ projectId, region: activePipeline.region, pipelineJobId: id });
      if (!res.ok) throw new Error(res.error);
      setActivePipeline(res.data);
    } catch (err: any) {
      setError(String(err));
    }
  }, [activePipeline, projectId]);

  // Auto-refresh DAG every 15s when the pipeline is active
  useEffect(() => {
    if (viewMode !== 'dag' || !activePipeline || !ACTIVE_STATES.has(activePipeline.state)) return;
    const timer = setInterval(refreshPipeline, 15000);
    return () => clearInterval(timer);
  }, [viewMode, activePipeline, refreshPipeline]);

  const backToList = useCallback(() => {
    setViewMode('list');
    setActivePipeline(null);
    setSelectedTask(null);
  }, []);

  // When a task is selected, switch to node details tab
  const handleSelectTask = useCallback((taskId: string | null) => {
    setSelectedTask(taskId);
    if (taskId) setDetailTab('node');
  }, []);

  const ALL_PIPELINE_STATES = [
    'QUEUED', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLING', 'CANCELLED', 'PAUSED',
  ];

  const filteredJobs = useMemo(() => {
    const filtered = stateFilter.size === 0 ? jobs : jobs.filter((j) => stateFilter.has(j.state));
    return [...filtered].sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
      return tb - ta;
    });
  }, [jobs, stateFilter]);

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selected.size === filteredJobs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredJobs.map((j) => j.name)));
    }
  }, [filteredJobs, selected]);

  const selectedJobs = useMemo(
    () => filteredJobs.filter((j) => selected.has(j.name)),
    [filteredJobs, selected]
  );

  const cancellableJobs = useMemo(
    () => selectedJobs.filter((j) => ACTIVE_STATES.has(j.state)),
    [selectedJobs]
  );
  const deletableJobs = useMemo(
    () => selectedJobs.filter((j) => !ACTIVE_STATES.has(j.state)),
    [selectedJobs]
  );

  const cancelSelected = useCallback(async () => {
    if (cancellableJobs.length === 0) return;
    setActionMsg('');
    let ok = 0;
    const errors: string[] = [];
    for (const j of cancellableJobs) {
      const res = await window.pipelines.cancel(j.name);
      if (res.ok) ok++;
      else errors.push(`${pipelineJobId(j.name)}: ${res.error}`);
    }
    if (ok) setActionMsg(`Requested cancellation for ${ok} pipeline(s).`);
    if (errors.length) setError(errors.join('\n'));
    setSelected(new Set());
    setTimeout(fetchJobs, 1500);
  }, [cancellableJobs, fetchJobs]);

  const deleteSelected = useCallback(async () => {
    if (deletableJobs.length === 0) return;
    setActionMsg('');
    let ok = 0;
    const errors: string[] = [];
    for (const j of deletableJobs) {
      const res = await window.pipelines.delete(j.name);
      if (res.ok) ok++;
      else errors.push(`${pipelineJobId(j.name)}: ${res.error}`);
    }
    if (ok) setActionMsg(`Deleted ${ok} pipeline(s).`);
    if (errors.length) setError(errors.join('\n'));
    setSelected(new Set());
    setTimeout(fetchJobs, 1500);
  }, [deletableJobs, fetchJobs]);

  const toggleRegion = useCallback((r: string) => {
    setRegions((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }, []);

  const toggleStateFilter = useCallback((s: string) => {
    setStateFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  const selectedTaskDetail = useMemo(
    () => (activePipeline && selectedTask ? activePipeline.taskDetails.find((t) => t.taskId === selectedTask) : null),
    [activePipeline, selectedTask]
  );

  // ── DAG View ──────────────────────────────────────────────────────────
  if (viewMode === 'dag' && activePipeline) {
    return (
      <div className="pipe-layout">
        <div className="pipe-dag-toolbar">
          <button className="secondary-button" onClick={backToList}>&larr; Back to list</button>
          <div className="pipe-dag-title">
            <span className="pipe-dag-name">{activePipeline.displayName}</span>
            <span className={`vai-state vai-state-${activePipeline.state.toLowerCase()}`}>
              {PIPELINE_STATUS_EMOJI[activePipeline.state] ?? ''} {activePipeline.state}
            </span>
            <span className="pipe-dag-meta">
              {activePipeline.region} &middot; {formatDuration(activePipeline.startTime, activePipeline.endTime)}
            </span>
          </div>
          <DagProgressBar tasks={activePipeline.taskDetails} />
          <div className="pipe-dag-actions">
            <button className="secondary-button" onClick={refreshPipeline}>
              Refresh
            </button>
            {ACTIVE_STATES.has(activePipeline.state) && (
              <span className="pipe-auto-refresh-hint">Auto-refreshes every 15s</span>
            )}
            <button
              className="vai-link-btn"
              onClick={() => window.shell.openExternal(consoleUrl(activePipeline, projectId))}
            >
              Console
            </button>
            <button
              className="vai-link-btn"
              onClick={() => window.shell.openExternal(logsUrl(activePipeline, projectId))}
            >
              Logs
            </button>
          </div>
        </div>

        <div className="pipe-dag-body">
          <PipelineDag
            tasks={activePipeline.taskDetails}
            selectedTask={selectedTask}
            onSelectTask={handleSelectTask}
          />
          <DagDetailPanel
            job={activePipeline}
            projectId={projectId}
            selectedTask={selectedTaskDetail ?? null}
            activeTab={detailTab}
            onTabChange={setDetailTab}
          />
        </div>

        {activePipeline.error && (
          <div className="vai-msg vai-msg-err" style={{ marginTop: 'auto' }}>
            Pipeline error: {activePipeline.error.message}
          </div>
        )}
      </div>
    );
  }

  // ── List View ─────────────────────────────────────────────────────────
  return (
    <div className="vai-layout">
      {/* Toolbar */}
      <div className="vai-toolbar">
        <div className="vai-toolbar-left">
          <form
            className="vai-project-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (projectInput.trim()) setProjectId(projectInput.trim());
            }}
          >
            <input
              className="vai-project-input"
              placeholder="Project ID"
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
            />
            <button className="primary-button" type="submit">Load</button>
          </form>
          <button className="secondary-button" onClick={fetchJobs} disabled={loading}>
            Refresh
          </button>
        </div>
        <div className="vai-toolbar-right">
          <div className="vai-filter-group">
            <span className="vai-filter-label">Regions</span>
            <div className="vai-chips">
              {SUPPORTED_REGIONS.map((r) => (
                <button
                  key={r}
                  className={`vai-chip ${regions.includes(r) ? 'active' : ''}`}
                  onClick={() => toggleRegion(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="vai-filter-group">
            <span className="vai-filter-label">State</span>
            <div className="vai-chips">
              {ALL_PIPELINE_STATES.map((s) => (
                <button
                  key={s}
                  className={`vai-chip ${stateFilter.has(s) ? 'active' : ''}`}
                  onClick={() => toggleStateFilter(s)}
                >
                  {PIPELINE_STATUS_EMOJI[s]} {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      {selectedJobs.length > 0 && (
        <div className="vai-action-bar">
          <span>{selectedJobs.length} pipeline(s) selected</span>
          <div className="vai-action-buttons">
            <button
              className="secondary-button"
              disabled={cancellableJobs.length === 0}
              onClick={cancelSelected}
            >
              Cancel{cancellableJobs.length > 0 ? ` (${cancellableJobs.length})` : ''}
            </button>
            <button
              className="danger-button"
              disabled={deletableJobs.length === 0}
              onClick={deleteSelected}
            >
              Delete{deletableJobs.length > 0 ? ` (${deletableJobs.length})` : ''}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      {actionMsg && (
        <div className="vai-msg vai-msg-ok" onClick={() => setActionMsg('')}>{actionMsg}</div>
      )}
      {error && (
        <div className="vai-msg vai-msg-err" onClick={() => setError('')}>{error}</div>
      )}

      {/* Pipeline list */}
      <div className="vai-body">
        <div className="vai-table-area">
          {(loading || loadingDetail) && <div className="vai-loading">{loadingDetail ? 'Loading pipeline details...' : 'Loading pipelines...'}</div>}
          {!loading && !loadingDetail && filteredJobs.length === 0 && (
            <div className="empty-state">No pipeline runs found. Enter a project ID and select regions above.</div>
          )}
          {!loading && !loadingDetail && filteredJobs.length > 0 && (
            <>
              <div className="vai-table-wrapper">
                <table className="vai-table">
                  <thead>
                    <tr>
                      <th className="vai-th-check">
                        <input
                          type="checkbox"
                          checked={selected.size === filteredJobs.length && filteredJobs.length > 0}
                          onChange={selectAll}
                        />
                      </th>
                      <th>Pipeline</th>
                      <th>Region</th>
                      <th>State</th>
                      <th>Duration</th>
                      <th>Created</th>
                      <th>Tasks</th>
                      <th>Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((job) => (
                      <tr
                        key={job.name}
                        className={`vai-row ${selected.has(job.name) ? 'selected' : ''}`}
                      >
                        <td className="vai-td-check">
                          <input
                            type="checkbox"
                            checked={selected.has(job.name)}
                            onChange={() => toggleSelect(job.name)}
                          />
                        </td>
                        <td
                          className="vai-td-name"
                          onClick={() => openPipelineDetail(job)}
                        >
                          {job.displayName}
                        </td>
                        <td className="vai-td-region">{job.region}</td>
                        <td className="vai-td-state">
                          <span className={`vai-state vai-state-${job.state.toLowerCase()}`}>
                            {PIPELINE_STATUS_EMOJI[job.state] ?? ''} {job.state}
                          </span>
                        </td>
                        <td className="vai-td-time">{formatDuration(job.startTime, job.endTime)}</td>
                        <td className="vai-td-time">{formatTime(job.createTime)}</td>
                        <td className="vai-td-region">{job.taskDetails.length || '-'}</td>
                        <td className="vai-td-links">
                          <button
                            className="vai-link-btn"
                            onClick={() => window.shell.openExternal(consoleUrl(job, projectId))}
                          >
                            Console
                          </button>
                          <button
                            className="vai-link-btn"
                            onClick={() => window.shell.openExternal(logsUrl(job, projectId))}
                          >
                            Logs
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="vai-load-more">
                {regions.map(
                  (r) =>
                    pageTokens[r] && (
                      <button
                        key={r}
                        className="secondary-button"
                        disabled={loadingMore === r}
                        onClick={() => loadMore(r)}
                      >
                        {loadingMore === r ? `Loading ${r}...` : `Load more in ${r}`}
                      </button>
                    )
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PipelinesTab;
