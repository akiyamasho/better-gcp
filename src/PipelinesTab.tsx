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

// ── DAG Layout ──────────────────────────────────────────────────────────

type DagNode = PipelineTaskDetail & { x: number; y: number; depth: number; children: string[] };

const NODE_W = 200;
const NODE_H = 60;
const H_GAP = 60;
const V_GAP = 32;

function buildDag(tasks: PipelineTaskDetail[]): { nodes: Map<string, DagNode>; width: number; height: number } {
  const nodes = new Map<string, DagNode>();
  const childMap = new Map<string, string[]>();

  // Build parent→children map
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
  // Copy children refs
  for (const [id, children] of childMap) {
    const node = nodes.get(id);
    if (node) node.children = children;
  }

  // Find roots (no parent or parent not in set)
  const roots: string[] = [];
  for (const t of tasks) {
    if (!t.parentTaskId || !nodes.has(t.parentTaskId)) {
      roots.push(t.taskId);
    }
  }

  // BFS to assign depth
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

  // Group by depth
  const depthGroups = new Map<number, string[]>();
  for (const [id, node] of nodes) {
    if (!depthGroups.has(node.depth)) depthGroups.set(node.depth, []);
    depthGroups.get(node.depth)!.push(id);
  }

  // Assign positions
  let maxX = 0;
  for (const [depth, ids] of depthGroups) {
    const x = depth * (NODE_W + H_GAP);
    for (let i = 0; i < ids.length; i++) {
      const node = nodes.get(ids[i])!;
      node.x = x;
      node.y = i * (NODE_H + V_GAP);
      maxX = Math.max(maxX, node.x + NODE_W);
    }
  }

  const maxY = Math.max(...Array.from(nodes.values()).map((n) => n.y + NODE_H), NODE_H);
  return { nodes, width: maxX + 40, height: maxY + 40 };
}

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

  const { nodes, width, height } = useMemo(() => buildDag(tasks), [tasks]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(2, Math.max(0.3, z * delta)));
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Don't start drag if clicking a node
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

  const stateColor = (state: string) => {
    switch (state) {
      case 'SUCCEEDED': return '#16a34a';
      case 'FAILED': return '#dc2626';
      case 'RUNNING': return '#2563eb';
      case 'PENDING': case 'NOT_STARTED': return '#d97706';
      case 'SKIPPED': return '#9ca3af';
      case 'CANCELLED': case 'CANCELLING': return '#6b7280';
      default: return '#6b7280';
    }
  };

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
        <button className="secondary-button dag-ctrl-btn" onClick={handleResetView}>Reset</button>
        <span className="dag-zoom-label">{Math.round(zoom * 100)}%</span>
      </div>
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
          width={width * zoom + 400}
          height={height * zoom + 200}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        >
          <g transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}>
            {edges.map((edge, i) => {
              const x1 = edge.from.x + NODE_W;
              const y1 = edge.from.y + NODE_H / 2;
              const x2 = edge.to.x;
              const y2 = edge.to.y + NODE_H / 2;
              const cx = (x1 + x2) / 2;
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={2}
                  markerEnd="url(#arrowhead)"
                />
              );
            })}
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="var(--muted)" />
              </marker>
            </defs>
          </g>
        </svg>
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: '0 0',
            position: 'relative',
          }}
        >
          {Array.from(nodes.values()).map((node) => (
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
              <div className="dag-node-name">{node.taskName}</div>
              <div className="dag-node-meta">
                <span className="dag-node-state" style={{ color: stateColor(node.state) }}>
                  {TASK_STATUS_EMOJI[node.state] ?? ''} {node.state}
                </span>
                <span className="dag-node-time">{formatDuration(node.startTime, node.endTime)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Task Detail Panel ───────────────────────────────────────────────────

const TaskDetailPanel: React.FC<{
  task: PipelineTaskDetail;
  onClose: () => void;
}> = ({ task, onClose }) => (
  <div className="pipe-task-detail">
    <div className="vai-detail-header">
      <h3>{task.taskName}</h3>
      <button className="vai-detail-close" onClick={onClose}>&times;</button>
    </div>
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
      } catch (err: any) {
        setError(String(err));
      } finally {
        setLoadingDetail(false);
      }
    },
    [projectId]
  );

  const backToList = useCallback(() => {
    setViewMode('list');
    setActivePipeline(null);
    setSelectedTask(null);
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
          <div className="pipe-dag-actions">
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

        {/* Runtime config summary */}
        {activePipeline.runtimeConfig?.parameterValues &&
          Object.keys(activePipeline.runtimeConfig.parameterValues).length > 0 && (
            <details className="pipe-params-bar">
              <summary>
                Runtime Parameters ({Object.keys(activePipeline.runtimeConfig.parameterValues).length})
              </summary>
              <div className="vai-detail-grid" style={{ padding: '8px 0' }}>
                {Object.entries(activePipeline.runtimeConfig.parameterValues).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span className="vai-detail-label">{k}</span>
                    <span className="vai-detail-mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </React.Fragment>
                ))}
              </div>
            </details>
          )}

        <div className="pipe-dag-body">
          <PipelineDag
            tasks={activePipeline.taskDetails}
            selectedTask={selectedTask}
            onSelectTask={setSelectedTask}
          />
          {selectedTaskDetail && (
            <TaskDetailPanel task={selectedTaskDetail} onClose={() => setSelectedTask(null)} />
          )}
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
