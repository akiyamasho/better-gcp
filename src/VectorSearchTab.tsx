import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { VectorSearchIndex, IndexEndpoint } from '@shared/types';
import RegionSelect from './RegionSelect';

const KNOWN_PROJECTS_KEY = 'better-gcp:vectorsearch-known-projects';
const ACTIVE_PROJECTS_KEY = 'better-gcp:vectorsearch-active-projects';
const REGIONS_KEY = 'better-gcp:vectorsearch-regions';

function readStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeStringList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Ignore storage errors.
  }
}

function formatTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
}

function indexName(fullName: string): string {
  const parts = fullName.split('/');
  return parts[parts.length - 1] ?? fullName;
}

function statusEmoji(state: string): string {
  switch (state) {
    case 'CREATED':
      return '✅';
    case 'CREATING':
    case 'UPDATING':
      return '⏳';
    case 'DELETING':
      return '🗑️';
    default:
      return '❓';
  }
}

function consoleUrl(index: VectorSearchIndex, projectId: string): string {
  const id = indexName(index.name);
  return `https://console.cloud.google.com/vertex-ai/matching-engine/indexes/${id}?project=${projectId}`;
}

function endpointConsoleUrl(endpoint: IndexEndpoint, projectId: string): string {
  const id = indexName(endpoint.name);
  return `https://console.cloud.google.com/vertex-ai/matching-engine/index-endpoints/${id}?project=${projectId}`;
}

type VectorSearchTabProps = {
  isActive?: boolean;
};

const VectorSearchTab = ({ isActive }: VectorSearchTabProps) => {
  const [knownProjects, setKnownProjects] = useState<string[]>(() => readStringList(KNOWN_PROJECTS_KEY));
  const [activeProjects, setActiveProjects] = useState<Set<string>>(() => new Set(readStringList(ACTIVE_PROJECTS_KEY)));
  const [projectInput, setProjectInput] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  const [regions, setRegions] = useState<string[]>(() => {
    const saved = readStringList(REGIONS_KEY);
    return saved.length > 0 ? saved : ['us-west1'];
  });

  const [indices, setIndices] = useState<VectorSearchIndex[]>([]);
  const [endpoints, setEndpoints] = useState<IndexEndpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedIndices, setSelectedIndices] = useState<Set<string>>(new Set());
  const [selectedView, setSelectedView] = useState<'indices' | 'endpoints'>('indices');

  useEffect(() => {
    writeStringList(KNOWN_PROJECTS_KEY, knownProjects);
  }, [knownProjects]);

  useEffect(() => {
    writeStringList(ACTIVE_PROJECTS_KEY, Array.from(activeProjects));
  }, [activeProjects]);

  useEffect(() => {
    writeStringList(REGIONS_KEY, regions);
  }, [regions]);

  const addProject = useCallback((projectId: string) => {
    if (!projectId.trim()) return;
    setKnownProjects((prev) => (prev.includes(projectId) ? prev : [...prev, projectId]));
    setActiveProjects((prev) => new Set(prev).add(projectId));
    setProjectInput('');
    setShowProjectDropdown(false);
  }, []);

  const toggleProject = useCallback((projectId: string) => {
    setActiveProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const removeProject = useCallback((projectId: string) => {
    setKnownProjects((prev) => prev.filter((p) => p !== projectId));
    setActiveProjects((prev) => {
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
  }, []);

  const loadData = useCallback(async () => {
    if (activeProjects.size === 0 || regions.length === 0) {
      setIndices([]);
      setEndpoints([]);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const allIndices: VectorSearchIndex[] = [];
      const allEndpoints: IndexEndpoint[] = [];

      for (const projectId of Array.from(activeProjects)) {
        for (const region of regions) {
          try {
            const [idxResult, epResult] = await Promise.all([
              window.vectorsearch.listIndices({ projectId, region }),
              window.vectorsearch.listEndpoints({ projectId, region }),
            ]);

            if (idxResult.ok) {
              allIndices.push(...idxResult.data.indices.map((i) => ({ ...i, projectId } as VectorSearchIndex & { projectId: string })));
            }
            if (epResult.ok) {
              allEndpoints.push(...epResult.data.endpoints.map((e) => ({ ...e, projectId } as IndexEndpoint & { projectId: string })));
            }
          } catch (err) {
            // Continue loading other regions even if one fails
            console.error(`Failed to load ${region} for ${projectId}:`, err);
          }
        }
      }

      setIndices(allIndices);
      setEndpoints(allEndpoints);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [activeProjects, regions]);

  useEffect(() => {
    if (isActive) {
      void loadData();
    }
  }, [isActive, loadData]);

  const toggleSelectIndex = useCallback((name: string) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const selectAllIndices = useCallback(() => {
    if (selectedIndices.size === indices.length && indices.length > 0) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(indices.map((i) => i.name)));
    }
  }, [indices, selectedIndices.size]);

  const deleteSelected = useCallback(async () => {
    if (selectedIndices.size === 0) return;
    if (!confirm(`Delete ${selectedIndices.size} index(es)?`)) return;

    const names = Array.from(selectedIndices);
    setError('');

    for (const name of names) {
      const result = await window.vectorsearch.deleteIndex(name);
      if (!result.ok) {
        setError(`Failed to delete ${indexName(name)}: ${result.error}`);
        break;
      }
    }

    setSelectedIndices(new Set());
    await loadData();
  }, [selectedIndices, loadData]);

  const projectOptions = useMemo(() => {
    if (!projectInput.trim()) return knownProjects;
    const lower = projectInput.toLowerCase();
    return knownProjects.filter((p) => p.toLowerCase().includes(lower));
  }, [knownProjects, projectInput]);

  return (
    <div className="vai-container">
      {/* Top toolbar */}
      <div className="vai-toolbar">
        <div className="vai-toolbar-section">
          <div className="vai-project-selector">
            <label className="vai-toolbar-label">Projects</label>
            <div className="vai-project-input-wrapper">
              <input
                className="vai-project-input"
                value={projectInput}
                onChange={(e) => {
                  setProjectInput(e.target.value);
                  setShowProjectDropdown(true);
                }}
                onFocus={() => setShowProjectDropdown(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projectInput.trim()) {
                    addProject(projectInput.trim());
                  } else if (e.key === 'Escape') {
                    setShowProjectDropdown(false);
                  }
                }}
                placeholder="Enter project ID"
              />
              {showProjectDropdown && (
                <div className="vai-project-dropdown">
                  {projectOptions.length === 0 && projectInput.trim() && (
                    <button
                      className="vai-project-option vai-project-option-add"
                      onClick={() => addProject(projectInput.trim())}
                    >
                      + Add "{projectInput.trim()}"
                    </button>
                  )}
                  {projectOptions.map((p) => (
                    <div key={p} className="vai-project-option">
                      <input
                        type="checkbox"
                        checked={activeProjects.has(p)}
                        onChange={() => toggleProject(p)}
                      />
                      <span className="vai-project-option-label">{p}</span>
                      <button
                        className="vai-project-option-remove"
                        onClick={() => removeProject(p)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="vai-project-pills">
              {Array.from(activeProjects).map((p) => (
                <div key={p} className="vai-project-pill">
                  {p}
                  <button className="vai-project-pill-remove" onClick={() => toggleProject(p)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <RegionSelect regions={regions} onChange={setRegions} />

          <button className="primary-button" onClick={() => void loadData()}>
            Load
          </button>
        </div>

        <div className="vai-toolbar-section">
          <div className="vai-view-tabs">
            <button
              className={`vai-view-tab ${selectedView === 'indices' ? 'active' : ''}`}
              onClick={() => setSelectedView('indices')}
            >
              Indices ({indices.length})
            </button>
            <button
              className={`vai-view-tab ${selectedView === 'endpoints' ? 'active' : ''}`}
              onClick={() => setSelectedView('endpoints')}
            >
              Endpoints ({endpoints.length})
            </button>
          </div>

          {selectedView === 'indices' && selectedIndices.size > 0 && (
            <button className="danger-button" onClick={() => void deleteSelected()}>
              Delete ({selectedIndices.size})
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="vai-msg vai-msg-err" onClick={() => setError('')}>
          {error}
        </div>
      )}

      {/* Content */}
      <div className="vai-body">
        <div className="vai-table-area">
          {loading && <div className="vai-loading">Loading vector search resources...</div>}
          {!loading && activeProjects.size === 0 && (
            <div className="empty-state">Enter a project ID above.</div>
          )}
          {!loading && activeProjects.size > 0 && selectedView === 'indices' && indices.length === 0 && (
            <div className="empty-state">No indices found in selected projects and regions.</div>
          )}
          {!loading && activeProjects.size > 0 && selectedView === 'endpoints' && endpoints.length === 0 && (
            <div className="empty-state">No index endpoints found in selected projects and regions.</div>
          )}

          {/* Indices table */}
          {!loading && selectedView === 'indices' && indices.length > 0 && (
            <div className="vai-table-wrapper">
              <table className="vai-table">
                <thead>
                  <tr>
                    <th className="vai-th-check">
                      <input
                        type="checkbox"
                        checked={selectedIndices.size === indices.length && indices.length > 0}
                        onChange={selectAllIndices}
                      />
                    </th>
                    <th>Index</th>
                    <th>Project</th>
                    <th>Region</th>
                    <th>State</th>
                    <th>Vectors</th>
                    <th>Dimensions</th>
                    <th>Deployed</th>
                    <th>Created</th>
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {indices.map((idx) => (
                    <tr key={idx.name} className={`vai-row ${selectedIndices.has(idx.name) ? 'selected' : ''}`}>
                      <td className="vai-td-check">
                        <input
                          type="checkbox"
                          checked={selectedIndices.has(idx.name)}
                          onChange={() => toggleSelectIndex(idx.name)}
                        />
                      </td>
                      <td className="vai-td-name">{idx.displayName}</td>
                      <td className="vai-td-region">{(idx as any).projectId || '-'}</td>
                      <td className="vai-td-region">{idx.region}</td>
                      <td className="vai-td-state">
                        <span className={`vai-state vai-state-${idx.state.toLowerCase()}`}>
                          {statusEmoji(idx.state)} {idx.state}
                        </span>
                      </td>
                      <td className="vai-td-region">
                        {idx.indexStats?.vectorsCount ? Number(idx.indexStats.vectorsCount).toLocaleString() : '-'}
                      </td>
                      <td className="vai-td-region">
                        {idx.metadata?.config?.dimensions?.toLocaleString() || '-'}
                      </td>
                      <td className="vai-td-region">{idx.deployedIndexes.length || '-'}</td>
                      <td className="vai-td-time">{formatTime(idx.createTime)}</td>
                      <td className="vai-td-links">
                        <button
                          className="vai-link-btn"
                          onClick={() => window.shell.openExternal(consoleUrl(idx, (idx as any).projectId))}
                        >
                          Console
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Endpoints table */}
          {!loading && selectedView === 'endpoints' && endpoints.length > 0 && (
            <div className="vai-table-wrapper">
              <table className="vai-table">
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Project</th>
                    <th>Region</th>
                    <th>Public</th>
                    <th>Network</th>
                    <th>Deployed Indices</th>
                    <th>Created</th>
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((ep) => (
                    <tr key={ep.name} className="vai-row">
                      <td className="vai-td-name">{ep.displayName}</td>
                      <td className="vai-td-region">{(ep as any).projectId || '-'}</td>
                      <td className="vai-td-region">{ep.region}</td>
                      <td className="vai-td-region">{ep.publicEndpointEnabled ? '✅ Yes' : '❌ No'}</td>
                      <td className="vai-td-mono" style={{ fontSize: 11 }}>
                        {ep.network ? ep.network.split('/').pop() : '-'}
                      </td>
                      <td className="vai-td-region">{ep.deployedIndexes.length || '-'}</td>
                      <td className="vai-td-time">{formatTime(ep.createTime)}</td>
                      <td className="vai-td-links">
                        <button
                          className="vai-link-btn"
                          onClick={() => window.shell.openExternal(endpointConsoleUrl(ep, (ep as any).projectId))}
                        >
                          Console
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VectorSearchTab;
