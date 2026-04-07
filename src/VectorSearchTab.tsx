import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { VectorSearchIndex, IndexEndpoint } from '@shared/types';
import RegionSelect from './RegionSelect';

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
  return `https://console.cloud.google.com/vertex-ai/locations/${index.region}/indexes/${id}/deployments?project=${projectId}`;
}

function endpointConsoleUrl(endpoint: IndexEndpoint, projectId: string): string {
  const id = indexName(endpoint.name);
  return `https://console.cloud.google.com/vertex-ai/locations/${endpoint.region}/index-endpoints/${id}?project=${projectId}`;
}

type VectorSearchTabProps = {
  isActive?: boolean;
};

const VectorSearchTab = ({ isActive }: VectorSearchTabProps) => {
  const [projectId, setProjectId] = useState('');
  const [projectInput, setProjectInput] = useState('');

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
    writeStringList(REGIONS_KEY, regions);
  }, [regions]);

  useEffect(() => {
    (window as any).bq?.listProjects?.().then((res: any) => {
      if (res?.ok && res.data?.length > 0) {
        const first = res.data[0].id;
        setProjectId(first);
        setProjectInput(first);
      }
    });
  }, []);

  const loadData = useCallback(async () => {
    if (!projectId || regions.length === 0) {
      setIndices([]);
      setEndpoints([]);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const allIndices: VectorSearchIndex[] = [];
      const allEndpoints: IndexEndpoint[] = [];

      for (const region of regions) {
        try {
          const [idxResult, epResult] = await Promise.all([
            window.vectorsearch.listIndices({ projectId, region }),
            window.vectorsearch.listEndpoints({ projectId, region }),
          ]);

          if (idxResult.ok) {
            allIndices.push(...idxResult.data.indices);
          }
          if (epResult.ok) {
            allEndpoints.push(...epResult.data.endpoints);
          }
        } catch (err) {
          // Continue loading other regions even if one fails
          console.error(`Failed to load ${region} for ${projectId}:`, err);
        }
      }

      setIndices(allIndices);
      setEndpoints(allEndpoints);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, regions]);

  useEffect(() => {
    if (projectId) {
      void loadData();
    }
  }, [projectId, regions, loadData]);

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

  return (
    <div className="vai-layout">
      {/* Top toolbar */}
      <div className="vai-toolbar">
        <div className="vai-toolbar-section">
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
          <button className="secondary-button" onClick={() => void loadData()} disabled={loading}>
            Refresh
          </button>

          <RegionSelect regions={regions} onChange={setRegions} />
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
          {!loading && !projectId && (
            <div className="empty-state">Enter a project ID and click Load.</div>
          )}
          {!loading && projectId && selectedView === 'indices' && indices.length === 0 && (
            <div className="empty-state">No indices found in selected regions.</div>
          )}
          {!loading && projectId && selectedView === 'endpoints' && endpoints.length === 0 && (
            <div className="empty-state">No index endpoints found in selected regions.</div>
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
                          onClick={() => window.shell.openExternal(consoleUrl(idx, projectId))}
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
                          onClick={() => window.shell.openExternal(endpointConsoleUrl(ep, projectId))}
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
