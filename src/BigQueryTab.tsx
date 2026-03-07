import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BqDataset,
  BqProject,
  BqQueryResult,
  BqSavedQuery,
  BqTable,
  BqTablePreview,
} from '@shared/types';

type QueryTab = {
  id: string;
  name: string;
  query: string;
  projectId?: string;
  result?: BqQueryResult;
  running: boolean;
  error?: string;
};

type TreeExpandState = {
  projects: Record<string, boolean>;
  datasets: Record<string, boolean>;
};

const FAVORITES_KEY = 'better-gcp:bq-favorites';
const FAV_PROJECTS_KEY = 'better-gcp:bq-fav-projects';
const EXTRA_PROJECTS_KEY = 'better-gcp:bq-extra-projects';

type ContextMenuState = {
  x: number;
  y: number;
  items: { label: string; action: () => void }[];
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = -1;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[idx]}`;
};

const readStringList = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const writeStringList = (key: string, values: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Ignore storage errors.
  }
};

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const middleTruncate = (text: string, maxLen = 28): string => {
  if (text.length <= maxLen) return text;
  const startLen = Math.ceil((maxLen - 1) / 2);
  const endLen = Math.floor((maxLen - 1) / 2);
  return text.slice(0, startLen) + '\u2026' + text.slice(text.length - endLen);
};

const IMAGE_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?)(\?\S*)?$/i;
const URL_RE = /^https?:\/\/\S+$/i;

type CellCoord = { row: number; col: number };

const renderCellContent = (value: string) => {
  if (!value) return value;
  if (IMAGE_URL_RE.test(value)) {
    return (
      <img
        src={value}
        alt=""
        className="bq-cell-image"
        title={value}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  if (URL_RE.test(value)) {
    return (
      <a
        href="#"
        className="bq-cell-link"
        title={value}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.shell.openExternal(value);
        }}
      >
        {value}
      </a>
    );
  }
  return value;
};

const BqGrid = ({ columns, rows }: { columns: string[]; rows: string[][] }) => {
  const [anchor, setAnchor] = useState<CellCoord | null>(null);
  const [focus, setFocus] = useState<CellCoord | null>(null);
  const [dragging, setDragging] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const inRange = useCallback(
    (row: number, col: number) => {
      if (!anchor || !focus) return false;
      const r0 = Math.min(anchor.row, focus.row);
      const r1 = Math.max(anchor.row, focus.row);
      const c0 = Math.min(anchor.col, focus.col);
      const c1 = Math.max(anchor.col, focus.col);
      return row >= r0 && row <= r1 && col >= c0 && col <= c1;
    },
    [anchor, focus]
  );

  const handleCellMouseDown = useCallback(
    (row: number, col: number, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'A' || (e.target as HTMLElement).tagName === 'IMG')
        return;
      e.preventDefault();
      wrapperRef.current?.focus();
      if (e.shiftKey && anchor) {
        setFocus({ row, col });
      } else {
        setAnchor({ row, col });
        setFocus({ row, col });
      }
      setDragging(true);
    },
    [anchor]
  );

  const handleCellMouseEnter = useCallback(
    (row: number, col: number) => {
      if (dragging) setFocus({ row, col });
    },
    [dragging]
  );

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'c' && anchor && focus) {
        e.preventDefault();
        const r0 = Math.min(anchor.row, focus.row);
        const r1 = Math.max(anchor.row, focus.row);
        const c0 = Math.min(anchor.col, focus.col);
        const c1 = Math.max(anchor.col, focus.col);
        const lines: string[] = [];
        for (let r = r0; r <= r1; r++) {
          const cells: string[] = [];
          for (let c = c0; c <= c1; c++) {
            cells.push(rows[r]?.[c] ?? '');
          }
          lines.push(cells.join('\t'));
        }
        navigator.clipboard.writeText(lines.join('\n'));
      }
      if (mod && e.key === 'a') {
        e.preventDefault();
        if (rows.length > 0 && columns.length > 0) {
          setAnchor({ row: 0, col: 0 });
          setFocus({ row: rows.length - 1, col: columns.length - 1 });
        }
      }
      if (focus && !mod) {
        let nr = focus.row;
        let nc = focus.col;
        if (e.key === 'ArrowDown') {
          nr = Math.min(nr + 1, rows.length - 1);
          e.preventDefault();
        }
        if (e.key === 'ArrowUp') {
          nr = Math.max(nr - 1, 0);
          e.preventDefault();
        }
        if (e.key === 'ArrowRight') {
          nc = Math.min(nc + 1, columns.length - 1);
          e.preventDefault();
        }
        if (e.key === 'ArrowLeft') {
          nc = Math.max(nc - 1, 0);
          e.preventDefault();
        }
        if (e.key === 'Tab') {
          nc = Math.min(nc + 1, columns.length - 1);
          e.preventDefault();
        }
        if (nr !== focus.row || nc !== focus.col) {
          if (e.shiftKey) {
            setFocus({ row: nr, col: nc });
          } else {
            setAnchor({ row: nr, col: nc });
            setFocus({ row: nr, col: nc });
          }
        }
      }
    },
    [anchor, focus, rows, columns]
  );

  const handleHeaderClick = useCallback(
    (col: number, e: React.MouseEvent) => {
      e.preventDefault();
      wrapperRef.current?.focus();
      setAnchor({ row: 0, col });
      setFocus({ row: rows.length - 1, col });
    },
    [rows.length]
  );

  return (
    <div
      ref={wrapperRef}
      className="bq-grid-wrapper"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <table className="bq-table">
        <thead>
          <tr>
            {columns.map((col, ci) => (
              <th
                key={col}
                onClick={(e) => handleHeaderClick(ci, e)}
                className="bq-th-clickable"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const selected = inRange(ri, ci);
                const isCursor = focus?.row === ri && focus?.col === ci;
                return (
                  <td
                    key={ci}
                    className={`${selected ? 'bq-cell-selected' : ''} ${isCursor ? 'bq-cell-cursor' : ''}`}
                    onMouseDown={(e) => handleCellMouseDown(ri, ci, e)}
                    onMouseEnter={() => handleCellMouseEnter(ri, ci)}
                  >
                    {renderCellContent(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

type BigQueryTabProps = {
  isActive?: boolean;
};

const BigQueryTab = ({ isActive = true }: BigQueryTabProps) => {
  const [projects, setProjects] = useState<BqProject[]>([]);
  const [datasets, setDatasets] = useState<Record<string, BqDataset[]>>({});
  const [tables, setTables] = useState<Record<string, BqTable[]>>({});
  const [expanded, setExpanded] = useState<TreeExpandState>({ projects: {}, datasets: {} });
  const [treeLoading, setTreeLoading] = useState<Record<string, boolean>>({});
  const [favorites, setFavorites] = useState<string[]>(() => readStringList(FAVORITES_KEY));
  const [favProjects, setFavProjects] = useState<string[]>(() => readStringList(FAV_PROJECTS_KEY));
  const [extraProjects, setExtraProjects] = useState<string[]>(() => readStringList(EXTRA_PROJECTS_KEY));
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectId, setNewProjectId] = useState('');
  const [addProjectLoading, setAddProjectLoading] = useState(false);
  const [addProjectError, setAddProjectError] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [preview, setPreview] = useState<BqTablePreview | null>(null);
  const [previewTarget, setPreviewTarget] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    { id: generateId(), name: 'Query 1', query: '', running: false },
  ]);
  const [activeTabId, setActiveTabId] = useState(queryTabs[0].id);

  const [savedQueries, setSavedQueries] = useState<BqSavedQuery[]>([]);
  const [showSavedQueries, setShowSavedQueries] = useState(false);
  const [showQuickJump, setShowQuickJump] = useState(false);
  const [quickJumpQuery, setQuickJumpQuery] = useState('');
  const [quickJumpIndex, setQuickJumpIndex] = useState(0);
  const [error, setError] = useState('');

  const quickJumpInputRef = useRef<HTMLInputElement>(null);
  const queryEditorRef = useRef<HTMLTextAreaElement>(null);

  const activeTab = useMemo(
    () => queryTabs.find((t) => t.id === activeTabId) ?? queryTabs[0],
    [queryTabs, activeTabId]
  );

  useEffect(() => {
    window.bq.listProjects().then((res) => {
      if (res.ok) {
        const detected = res.data;
        const extraIds = readStringList(EXTRA_PROJECTS_KEY);
        const existingIds = new Set(detected.map((p) => p.id));
        const extras = extraIds
          .filter((id) => !existingIds.has(id))
          .map((id) => ({ id, name: id }));
        setProjects([...detected, ...extras]);
      } else {
        setError(res.error);
      }
    });
    window.bq.loadSavedQueries().then((res) => {
      if (res.ok) setSavedQueries(res.data);
    });
  }, []);

  useEffect(() => {
    writeStringList(FAVORITES_KEY, favorites);
  }, [favorites]);

  useEffect(() => {
    writeStringList(FAV_PROJECTS_KEY, favProjects);
  }, [favProjects]);

  useEffect(() => {
    writeStringList(EXTRA_PROJECTS_KEY, extraProjects);
  }, [extraProjects]);

  const toggleProjectExpand = useCallback(async (projectId: string) => {
    setExpanded((prev) => {
      const isOpen = prev.projects[projectId];
      return { ...prev, projects: { ...prev.projects, [projectId]: !isOpen } };
    });
    if (!datasets[projectId]) {
      setTreeLoading((prev) => ({ ...prev, [projectId]: true }));
      const res = await window.bq.listDatasets({ projectId });
      if (res.ok) setDatasets((prev) => ({ ...prev, [projectId]: res.data }));
      setTreeLoading((prev) => ({ ...prev, [projectId]: false }));
    }
  }, [datasets]);

  const toggleDatasetExpand = useCallback(async (projectId: string, datasetId: string) => {
    const key = `${projectId}.${datasetId}`;
    setExpanded((prev) => {
      const isOpen = prev.datasets[key];
      return { ...prev, datasets: { ...prev.datasets, [key]: !isOpen } };
    });
    if (!tables[key]) {
      setTreeLoading((prev) => ({ ...prev, [key]: true }));
      const res = await window.bq.listTables({ projectId, datasetId });
      if (res.ok) setTables((prev) => ({ ...prev, [key]: res.data }));
      setTreeLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [tables]);

  const handlePreviewTable = useCallback(
    async (projectId: string, datasetId: string, tableId: string) => {
      const target = `${projectId}.${datasetId}.${tableId}`;
      setPreviewTarget(target);
      setPreviewLoading(true);
      setPreview(null);
      const res = await window.bq.previewTable({ projectId, datasetId, tableId });
      if (res.ok) setPreview(res.data);
      else setError(res.error);
      setPreviewLoading(false);
    },
    []
  );

  const updateActiveTab = useCallback(
    (updates: Partial<QueryTab>) => {
      setQueryTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, ...updates } : t))
      );
    },
    [activeTabId]
  );

  const handleRunQuery = useCallback(async () => {
    if (!activeTab.query.trim()) return;
    updateActiveTab({ running: true, error: undefined, result: undefined });
    const res = await window.bq.runQuery({
      query: activeTab.query,
      projectId: activeTab.projectId,
    });
    if (res.ok) {
      updateActiveTab({ running: false, result: res.data });
    } else {
      updateActiveTab({ running: false, error: res.error });
    }
  }, [activeTab, updateActiveTab]);

  const addQueryTab = useCallback(() => {
    const newTab: QueryTab = {
      id: generateId(),
      name: `Query ${queryTabs.length + 1}`,
      query: '',
      running: false,
    };
    setQueryTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [queryTabs.length]);

  const closeQueryTab = useCallback(
    (tabId: string) => {
      if (queryTabs.length <= 1) return;
      setQueryTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [queryTabs.length, activeTabId]
  );

  const handleSaveQuery = useCallback(async () => {
    if (!activeTab.query.trim()) return;
    const name = activeTab.name || `Saved ${savedQueries.length + 1}`;
    const newSaved: BqSavedQuery = {
      id: generateId(),
      name,
      query: activeTab.query,
      projectId: activeTab.projectId,
      createdAt: new Date().toISOString(),
    };
    const updated = [...savedQueries, newSaved];
    setSavedQueries(updated);
    await window.bq.saveSavedQueries(updated);
  }, [activeTab, savedQueries]);

  const handleLoadSavedQuery = useCallback(
    (saved: BqSavedQuery) => {
      updateActiveTab({ query: saved.query, name: saved.name, projectId: saved.projectId });
      setShowSavedQueries(false);
    },
    [updateActiveTab]
  );

  const handleDeleteSavedQuery = useCallback(
    async (id: string) => {
      const updated = savedQueries.filter((q) => q.id !== id);
      setSavedQueries(updated);
      await window.bq.saveSavedQueries(updated);
    },
    [savedQueries]
  );

  const toggleFavorite = useCallback((fullPath: string) => {
    setFavorites((prev) =>
      prev.includes(fullPath) ? prev.filter((f) => f !== fullPath) : [...prev, fullPath]
    );
  }, []);

  const handleFavoriteClick = useCallback(
    (path: string) => {
      const parts = path.split('.');
      if (parts.length === 3) {
        handlePreviewTable(parts[0], parts[1], parts[2]);
      }
    },
    [handlePreviewTable]
  );

  const toggleFavProject = useCallback((projectId: string) => {
    setFavProjects((prev) =>
      prev.includes(projectId) ? prev.filter((p) => p !== projectId) : [...prev, projectId]
    );
  }, []);

  const handleAddProject = useCallback(async () => {
    const trimmed = newProjectId.trim();
    if (!trimmed) return;
    if (projects.some((p) => p.id === trimmed)) {
      setShowAddProject(false);
      setNewProjectId('');
      setAddProjectError('');
      return;
    }
    setAddProjectLoading(true);
    setAddProjectError('');
    const res = await window.bq.listDatasets({ projectId: trimmed });
    setAddProjectLoading(false);
    if (!res.ok) {
      setAddProjectError(`Cannot access project "${trimmed}": ${res.error}`);
      return;
    }
    setProjects((prev) => [...prev, { id: trimmed, name: trimmed }]);
    setExtraProjects((prev) => [...prev, trimmed]);
    setDatasets((prev) => ({ ...prev, [trimmed]: res.data }));
    setShowAddProject(false);
    setNewProjectId('');
    setAddProjectError('');
  }, [newProjectId, projects]);

  const handleRemoveExtraProject = useCallback(
    (projectId: string) => {
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setExtraProjects((prev) => prev.filter((id) => id !== projectId));
      setFavProjects((prev) => prev.filter((id) => id !== projectId));
    },
    []
  );

  const buildFullTableId = (projectId: string, datasetId: string, tableId: string) =>
    `\`${projectId}.${datasetId}.${tableId}\``;

  const handleTableContextMenu = useCallback(
    (e: React.MouseEvent, projectId: string, datasetId: string, tableId: string) => {
      e.preventDefault();
      const fullId = buildFullTableId(projectId, datasetId, tableId);
      const dotPath = `${projectId}.${datasetId}.${tableId}`;
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: `Copy ${dotPath}`,
            action: () => {
              navigator.clipboard.writeText(dotPath);
              setContextMenu(null);
            },
          },
          {
            label: `Copy ${fullId}`,
            action: () => {
              navigator.clipboard.writeText(fullId);
              setContextMenu(null);
            },
          },
          {
            label: 'Insert into query editor',
            action: () => {
              insertIntoEditor(fullId);
              setContextMenu(null);
            },
          },
        ],
      });
    },
    []
  );

  const insertIntoEditor = useCallback(
    (text: string) => {
      const editor = queryEditorRef.current;
      if (!editor) {
        updateActiveTab({ query: activeTab.query + text });
        return;
      }
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const before = activeTab.query.slice(0, start);
      const after = activeTab.query.slice(end);
      updateActiveTab({ query: before + text + after });
      setTimeout(() => {
        editor.focus();
        editor.setSelectionRange(start + text.length, start + text.length);
      }, 0);
    },
    [activeTab.query, updateActiveTab]
  );

  const handleTableDragStart = useCallback(
    (e: React.DragEvent, projectId: string, datasetId: string, tableId: string) => {
      const fullId = buildFullTableId(projectId, datasetId, tableId);
      e.dataTransfer.setData('text/plain', fullId);
      e.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  const handleEditorDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const text = e.dataTransfer.getData('text/plain');
      if (text) insertIntoEditor(text);
    },
    [insertIntoEditor]
  );

  const handleEditorDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Quick jump items: all loaded tables and datasets
  const quickJumpItems = useMemo(() => {
    const items: { label: string; detail: string; path: string }[] = [];
    for (const [key, tableList] of Object.entries(tables)) {
      for (const table of tableList) {
        const path = `${key}.${table.id}`;
        items.push({
          label: table.id,
          detail: `${table.projectId}.${table.datasetId}`,
          path,
        });
      }
    }
    for (const [projectId, datasetList] of Object.entries(datasets)) {
      for (const dataset of datasetList) {
        items.push({
          label: dataset.id,
          detail: projectId,
          path: `${projectId}.${dataset.id}`,
        });
      }
    }
    return items;
  }, [tables, datasets]);

  const filteredQuickJump = useMemo(() => {
    if (!quickJumpQuery) return quickJumpItems;
    try {
      const regex = new RegExp(quickJumpQuery, 'i');
      return quickJumpItems.filter(
        (item) => regex.test(item.label) || regex.test(item.detail) || regex.test(item.path)
      );
    } catch {
      const lower = quickJumpQuery.toLowerCase();
      return quickJumpItems.filter(
        (item) =>
          item.label.toLowerCase().includes(lower) ||
          item.detail.toLowerCase().includes(lower)
      );
    }
  }, [quickJumpItems, quickJumpQuery]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setShowQuickJump(true);
        setQuickJumpQuery('');
        setQuickJumpIndex(0);
        setTimeout(() => quickJumpInputRef.current?.focus(), 50);
      }
      if (mod && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleRunQuery();
      }
    };
    const dismissContextMenu = () => setContextMenu(null);
    window.addEventListener('keydown', handler);
    window.addEventListener('click', dismissContextMenu);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('click', dismissContextMenu);
    };
  }, [handleRunQuery, isActive]);

  const handleQuickJumpSelect = useCallback(
    (item: { path: string }) => {
      setShowQuickJump(false);
      const parts = item.path.split('.');
      if (parts.length === 3) {
        handlePreviewTable(parts[0], parts[1], parts[2]);
      } else if (parts.length === 2) {
        toggleDatasetExpand(parts[0], parts[1]);
      }
    },
    [handlePreviewTable, toggleDatasetExpand]
  );

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo">BigQuery</div>
          <div className="subhead">Datasets &amp; Tables</div>
        </div>

        {favProjects.length > 0 && (
          <div className="sidebar-section">
            <div className="section-title">Favorite Projects</div>
            <div className="bucket-list compact">
              {favProjects.map((pid) => {
                const proj = projects.find((p) => p.id === pid);
                return (
                  <button
                    key={pid}
                    className="bucket-main"
                    onClick={() => toggleProjectExpand(pid)}
                    title={pid}
                  >
                    <span className="bucket-name">{proj?.name ?? pid}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {favorites.length > 0 && (
          <div className="sidebar-section">
            <div className="section-title">Favorite Tables</div>
            <div className="bucket-list compact">
              {favorites.map((fav) => (
                <button
                  key={fav}
                  className="bucket-main"
                  onClick={() => handleFavoriteClick(fav)}
                  title={fav}
                >
                  <span className="bucket-name">{fav.split('.').pop()}</span>
                  <span className="bucket-meta">{fav}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sidebar-section">
          <div className="section-header">
            <span className="section-title" style={{ marginBottom: 0 }}>Projects</span>
            <button
              className="section-add"
              onClick={() => setShowAddProject((v) => !v)}
              title="Add project"
            >
              +
            </button>
          </div>
          {showAddProject && (
            <div style={{ marginBottom: 12 }}>
              <form
                className="favorite-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddProject();
                }}
              >
                <input
                  className="favorite-input"
                  value={newProjectId}
                  onChange={(e) => {
                    setNewProjectId(e.target.value);
                    setAddProjectError('');
                  }}
                  placeholder="project-id"
                  disabled={addProjectLoading}
                  autoFocus
                />
                <button className="tiny-action" type="submit" disabled={addProjectLoading}>
                  {addProjectLoading ? '...' : 'Add'}
                </button>
              </form>
              {addProjectError && (
                <div className="add-project-error">{addProjectError}</div>
              )}
            </div>
          )}
          <div className="tree">
            {projects.map((project) => {
              const isExtraProject = extraProjects.includes(project.id);
              const isFavProject = favProjects.includes(project.id);
              return (
                <div key={project.id}>
                  <div className="tree-row">
                    <button
                      className="tree-toggle"
                      onClick={() => toggleProjectExpand(project.id)}
                    >
                      {expanded.projects[project.id] ? '−' : '+'}
                    </button>
                    <button
                      className={`favorite-toggle compact ${isFavProject ? 'active' : ''}`}
                      onClick={() => toggleFavProject(project.id)}
                      title={isFavProject ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {isFavProject ? '\u2605' : '\u2606'}
                    </button>
                    <button className="tree-label" onClick={() => toggleProjectExpand(project.id)} title={project.name}>
                      {middleTruncate(project.name, 26)}
                    </button>
                    {isExtraProject && (
                      <button
                        className="bq-tab-close"
                        onClick={() => handleRemoveExtraProject(project.id)}
                        title="Remove project"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {expanded.projects[project.id] && (
                    <div style={{ paddingLeft: 16 }}>
                      {treeLoading[project.id] && (
                        <div className="tree-loading">Loading datasets...</div>
                      )}
                      {(datasets[project.id] ?? []).map((ds) => {
                        const dsKey = `${project.id}.${ds.id}`;
                        return (
                          <div key={ds.id}>
                            <div className="tree-row">
                              <button
                                className="tree-toggle"
                                onClick={() => toggleDatasetExpand(project.id, ds.id)}
                              >
                                {expanded.datasets[dsKey] ? '−' : '+'}
                              </button>
                              <button
                                className="tree-label"
                                onClick={() => toggleDatasetExpand(project.id, ds.id)}
                                title={ds.id}
                              >
                                {middleTruncate(ds.id, 22)}
                              </button>
                            </div>
                            {expanded.datasets[dsKey] && (
                              <div style={{ paddingLeft: 16 }}>
                                {treeLoading[dsKey] && (
                                  <div className="tree-loading">Loading tables...</div>
                                )}
                                {(tables[dsKey] ?? []).map((table) => {
                                  const fullPath = `${dsKey}.${table.id}`;
                                  const isFav = favorites.includes(fullPath);
                                  return (
                                    <div
                                      key={table.id}
                                      className="tree-row"
                                      draggable
                                      onDragStart={(e) =>
                                        handleTableDragStart(e, project.id, ds.id, table.id)
                                      }
                                      onContextMenu={(e) =>
                                        handleTableContextMenu(e, project.id, ds.id, table.id)
                                      }
                                    >
                                      <button
                                        className={`favorite-toggle compact ${isFav ? 'active' : ''}`}
                                        onClick={() => toggleFavorite(fullPath)}
                                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                                      >
                                        {isFav ? '\u2605' : '\u2606'}
                                      </button>
                                      <button
                                        className={`tree-label ${previewTarget === fullPath ? 'bq-active-table' : ''}`}
                                        onClick={() =>
                                          handlePreviewTable(project.id, ds.id, table.id)
                                        }
                                        title={table.id}
                                      >
                                        {middleTruncate(table.id, 20)}
                                        <span className="bq-table-type">{table.type === 'VIEW' ? ' (view)' : ''}</span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {projects.length === 0 && !error && (
              <div className="tree-loading">Loading projects...</div>
            )}
          </div>
        </div>
      </div>

      <div className="main">
        <div className="bq-tab-bar">
          <div className="bq-tabs">
            {queryTabs.map((tab) => (
              <div
                key={tab.id}
                className={`bq-tab ${tab.id === activeTabId ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span className="bq-tab-name">{tab.name}</span>
                {queryTabs.length > 1 && (
                  <button
                    className="bq-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeQueryTab(tab.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button className="bq-tab-add" onClick={addQueryTab} title="New query tab">
              +
            </button>
          </div>
          <div className="bq-tab-actions">
            <button
              className="secondary-button"
              onClick={() => setShowSavedQueries(true)}
            >
              Saved
            </button>
            <button className="secondary-button" onClick={handleSaveQuery}>
              Save
            </button>
            <button
              className="primary-button"
              onClick={handleRunQuery}
              disabled={activeTab.running || !activeTab.query.trim()}
            >
              {activeTab.running ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>

        <div className="bq-editor-area">
          <textarea
            ref={queryEditorRef}
            className="bq-editor"
            value={activeTab.query}
            onChange={(e) => updateActiveTab({ query: e.target.value })}
            onDrop={handleEditorDrop}
            onDragOver={handleEditorDragOver}
            placeholder="SELECT * FROM `project.dataset.table` LIMIT 5 — drag a table here to insert its ID"
            spellCheck={false}
          />
        </div>

        <div className="bq-results-area">
          {error && <div className="bq-error">{error}</div>}
          {activeTab.error && <div className="bq-error">{activeTab.error}</div>}

          {activeTab.result && (
            <div className="bq-results">
              <div className="bq-results-meta">
                {activeTab.result.totalRows} row{activeTab.result.totalRows !== 1 ? 's' : ''} ·{' '}
                {activeTab.result.durationMs}ms ·{' '}
                {formatBytes(activeTab.result.bytesProcessed)} processed
              </div>
              <div className="bq-table-wrapper">
                <BqGrid columns={activeTab.result.columns} rows={activeTab.result.rows} />
              </div>
            </div>
          )}

          {previewTarget && !activeTab.result && (
            <div className="bq-results">
              <div className="bq-results-meta">
                Preview: {previewTarget} (LIMIT 5)
              </div>
              {previewLoading && <div className="bq-results-meta">Loading preview...</div>}
              {preview && (
                <div className="bq-table-wrapper">
                  <BqGrid columns={preview.columns} rows={preview.rows} />
                </div>
              )}
            </div>
          )}

          {!activeTab.result && !previewTarget && !activeTab.running && (
            <div className="empty-state">
              Click a table to preview, or write a query and press Cmd+Enter to run.
            </div>
          )}
        </div>
      </div>

      {showSavedQueries && (
        <div className="modal-backdrop" onClick={() => setShowSavedQueries(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Saved Queries</span>
              <button className="secondary-button" onClick={() => setShowSavedQueries(false)}>
                Close
              </button>
            </div>
            <div className="modal-list">
              {savedQueries.length === 0 && (
                <div className="modal-empty">No saved queries yet.</div>
              )}
              {savedQueries.map((sq) => (
                <div key={sq.id} className="modal-item" onClick={() => handleLoadSavedQuery(sq)}>
                  <div className="modal-item-title">{sq.name}</div>
                  <div className="modal-item-meta">{sq.query.slice(0, 100)}</div>
                  <button
                    className="danger-button"
                    style={{ alignSelf: 'flex-end', marginTop: 4 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSavedQuery(sq.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.items.map((item) => (
            <button key={item.label} className="context-item" onClick={item.action}>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {showQuickJump && (
        <div className="modal-backdrop" onClick={() => setShowQuickJump(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Quick Jump</span>
              <span className="modal-shortcut">Cmd+Shift+P</span>
            </div>
            <div className="modal-note">Supports regex patterns</div>
            <input
              ref={quickJumpInputRef}
              className="modal-input"
              value={quickJumpQuery}
              onChange={(e) => {
                setQuickJumpQuery(e.target.value);
                setQuickJumpIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setQuickJumpIndex((i) => Math.min(i + 1, filteredQuickJump.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setQuickJumpIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && filteredQuickJump.length > 0) {
                  e.preventDefault();
                  handleQuickJumpSelect(filteredQuickJump[quickJumpIndex]);
                } else if (e.key === 'Escape') {
                  setShowQuickJump(false);
                }
              }}
              placeholder="Search tables and datasets..."
            />
            <div className="modal-list">
              {filteredQuickJump.length === 0 && (
                <div className="modal-empty">
                  {quickJumpItems.length === 0
                    ? 'Expand projects in the sidebar to load items.'
                    : 'No matches.'}
                </div>
              )}
              {filteredQuickJump.map((item, i) => (
                <button
                  key={item.path}
                  className={`modal-item ${i === quickJumpIndex ? 'active' : ''}`}
                  onClick={() => handleQuickJumpSelect(item)}
                >
                  <span className="modal-item-title">{item.label}</span>
                  <span className="modal-item-meta">{item.detail}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BigQueryTab;
