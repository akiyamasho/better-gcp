import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudRunService } from '@shared/types';
import RegionSelect from './RegionSelect';
const KNOWN_PROJECTS_KEY = 'better-gcp:cloudrun-known-projects';
const ACTIVE_PROJECTS_KEY = 'better-gcp:cloudrun-active-projects';

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

function readyStatus(svc: CloudRunService): 'ready' | 'not-ready' | 'unknown' {
  const ready = svc.conditions.find((c) => c.type === 'Ready');
  if (!ready) return 'unknown';
  if (ready.status === 'True') return 'ready';
  return 'not-ready';
}

function consoleUrl(svc: CloudRunService, projectId: string): string {
  return `https://console.cloud.google.com/run/detail/${svc.region}/${svc.name}/metrics?project=${projectId}`;
}

function logsUrl(svc: CloudRunService, projectId: string): string {
  const query = `resource.type%3D%22cloud_run_revision%22%0Aresource.labels.service_name%3D%22${svc.name}%22%0Aresource.labels.location%3D%22${svc.region}%22`;
  return `https://console.cloud.google.com/logs/query;query=${query}?project=${projectId}`;
}

function revisionsUrl(svc: CloudRunService, projectId: string): string {
  return `https://console.cloud.google.com/run/detail/${svc.region}/${svc.name}/revisions?project=${projectId}`;
}

type CloudRunTabProps = {
  isActive?: boolean;
};

const CloudRunTab = ({ isActive }: CloudRunTabProps) => {
  const [knownProjects, setKnownProjects] = useState<string[]>(() => readStringList(KNOWN_PROJECTS_KEY));
  const [activeProjects, setActiveProjects] = useState<Set<string>>(() => new Set(readStringList(ACTIVE_PROJECTS_KEY)));
  const [projectInput, setProjectInput] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const projectDropdownRef = React.useRef<HTMLDivElement>(null);
  const [regions, setRegions] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('better-gcp:cloudrun-regions');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return ['us-west1'];
  });
  const [services, setServices] = useState<CloudRunService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showJump, setShowJump] = useState(false);
  const [jumpQuery, setJumpQuery] = useState('');
  const [jumpIndex, setJumpIndex] = useState(0);
  const jumpInputRef = React.useRef<HTMLInputElement>(null);
  const [sortColumn, setSortColumn] = useState<'name' | 'project' | 'region' | 'status' | 'created'>('created');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const projects = useMemo(
    () => knownProjects.filter((p) => activeProjects.has(p)),
    [knownProjects, activeProjects]
  );

  const handleSort = useCallback((column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

  useEffect(() => {
    if (knownProjects.length > 0) return;
    (window as any).bq?.listProjects?.().then((res: any) => {
      if (res?.ok && res.data?.length > 0) {
        const first = res.data[0].id;
        setKnownProjects([first]);
        setActiveProjects(new Set([first]));
        writeStringList(KNOWN_PROJECTS_KEY, [first]);
        writeStringList(ACTIVE_PROJECTS_KEY, [first]);
      }
    });
  }, []);

  const addProject = useCallback(
    (id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      setKnownProjects((prev) => {
        const next = prev.includes(trimmed) ? prev : [...prev, trimmed];
        writeStringList(KNOWN_PROJECTS_KEY, next);
        return next;
      });
      setActiveProjects((prev) => {
        const next = new Set(prev);
        next.add(trimmed);
        writeStringList(ACTIVE_PROJECTS_KEY, [...next]);
        return next;
      });
    },
    []
  );

  const toggleProject = useCallback((id: string) => {
    setActiveProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStringList(ACTIVE_PROJECTS_KEY, [...next]);
      return next;
    });
  }, []);

  const removeProject = useCallback((id: string) => {
    setKnownProjects((prev) => {
      const next = prev.filter((p) => p !== id);
      writeStringList(KNOWN_PROJECTS_KEY, next);
      return next;
    });
    setActiveProjects((prev) => {
      const next = new Set(prev);
      next.delete(id);
      writeStringList(ACTIVE_PROJECTS_KEY, [...next]);
      return next;
    });
    setServices((prev) => prev.filter((s) => s.namespace !== id));
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setShowProjectDropdown(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const fetchServices = useCallback(async () => {
    if (projects.length === 0 || regions.length === 0) return;
    setLoading(true);
    setError('');
    setExpandedService(null);

    try {
      const requests = projects.flatMap((projectId) =>
        regions.map(async (region) => {
          const res = await window.cloudrun.listServices({ projectId, region });
          if (!res.ok) throw new Error(`${projectId}/${region}: ${res.error}`);
          return res.data.services;
        })
      );
      const results = await Promise.all(requests);
      const all = results.flat();
      all.sort((a, b) => {
        const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
        const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
        return tb - ta;
      });
      setServices(all);
    } catch (err: any) {
      setError(String(err));
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, [projects, regions]);

  useEffect(() => {
    if (projects.length > 0) fetchServices();
  }, [projects, regions, fetchServices]);

  const handleRegionsChange = useCallback((next: string[]) => {
    setRegions(next);
    try { localStorage.setItem('better-gcp:cloudrun-regions', JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const filteredServices = useMemo(() => {
    let filtered = services;
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      filtered = services.filter(
        (s) =>
          s.name.toLowerCase().includes(lower) ||
          s.namespace.toLowerCase().includes(lower) ||
          s.region.toLowerCase().includes(lower) ||
          s.containerImage.toLowerCase().includes(lower)
      );
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortColumn) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'project':
          aVal = a.namespace.toLowerCase();
          bVal = b.namespace.toLowerCase();
          break;
        case 'region':
          aVal = a.region.toLowerCase();
          bVal = b.region.toLowerCase();
          break;
        case 'status':
          aVal = readyStatus(a);
          bVal = readyStatus(b);
          break;
        case 'created':
          aVal = a.createTime ? new Date(a.createTime).getTime() : 0;
          bVal = b.createTime ? new Date(b.createTime).getTime() : 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [services, searchQuery, sortColumn, sortDirection]);

  const jumpItems = useMemo(() => {
    return services.map((s) => ({
      label: s.name,
      detail: `${s.namespace} / ${s.region}`,
      key: `${s.namespace}/${s.region}/${s.name}`,
      service: s,
    }));
  }, [services]);

  const filteredJump = useMemo(() => {
    if (!jumpQuery) return jumpItems;
    try {
      const regex = new RegExp(jumpQuery, 'i');
      return jumpItems.filter((item) => regex.test(item.label) || regex.test(item.detail));
    } catch {
      const lower = jumpQuery.toLowerCase();
      return jumpItems.filter(
        (item) => item.label.toLowerCase().includes(lower) || item.detail.toLowerCase().includes(lower)
      );
    }
  }, [jumpItems, jumpQuery]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setShowJump(true);
        setJumpQuery('');
        setJumpIndex(0);
        setTimeout(() => jumpInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive]);

  const handleJumpSelect = useCallback((item: (typeof jumpItems)[number]) => {
    setShowJump(false);
    setExpandedService(item.key);
  }, []);

  const detail = expandedService
    ? services.find((s) => `${s.namespace}/${s.region}/${s.name}` === expandedService)
    : null;

  return (
    <div className="vai-layout">
      {/* Toolbar */}
      <div className="vai-toolbar">
        <div className="vai-toolbar-left">
          <div className="cr-project-dropdown" ref={projectDropdownRef}>
            <button
              className="cr-project-dropdown-trigger"
              onClick={() => setShowProjectDropdown((v) => !v)}
            >
              Projects ({projects.length}/{knownProjects.length})
              <span className="cr-dropdown-arrow">{showProjectDropdown ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showProjectDropdown && (
              <div className="cr-project-dropdown-menu">
                <form
                  className="cr-project-dropdown-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (projectInput.trim()) {
                      addProject(projectInput.trim());
                      setProjectInput('');
                    }
                  }}
                >
                  <input
                    className="cr-project-dropdown-input"
                    placeholder="Add project ID..."
                    value={projectInput}
                    onChange={(e) => setProjectInput(e.target.value)}
                    autoFocus
                  />
                  <button className="primary-button cr-project-dropdown-add-btn" type="submit">
                    Add
                  </button>
                </form>
                {knownProjects.length === 0 && (
                  <div className="cr-project-dropdown-empty">
                    No projects yet. Type a project ID above.
                  </div>
                )}
                {[...knownProjects].sort((a, b) => {
                  const aActive = activeProjects.has(a) ? 0 : 1;
                  const bActive = activeProjects.has(b) ? 0 : 1;
                  if (aActive !== bActive) return aActive - bActive;
                  return a.localeCompare(b);
                }).map((p) => (
                  <div key={p} className="cr-project-dropdown-item">
                    <button
                      className={`cr-project-dropdown-toggle ${activeProjects.has(p) ? 'active' : ''}`}
                      onClick={() => toggleProject(p)}
                    >
                      <span className="cr-project-check">
                        {activeProjects.has(p) ? '\u2705' : '\u2B1C'}
                      </span>
                      <span className="cr-project-id">{p}</span>
                    </button>
                    <button
                      className="cr-project-remove"
                      onClick={() => removeProject(p)}
                      title="Remove project"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="secondary-button" onClick={fetchServices} disabled={loading}>
            Refresh
          </button>
        </div>
        <div className="vai-toolbar-right">
          <RegionSelect regions={regions} onChange={handleRegionsChange} />
        </div>
      </div>

      {/* Search bar */}
      <div className="cr-search-bar">
        <input
          className="cr-search-input"
          placeholder="Filter services by name, project, region, or image..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span className="cr-search-count">
          {filteredServices.length} service{filteredServices.length !== 1 ? 's' : ''}
        </span>
        <button
          className="secondary-button"
          onClick={() => {
            setShowJump(true);
            setJumpQuery('');
            setJumpIndex(0);
            setTimeout(() => jumpInputRef.current?.focus(), 50);
          }}
          title="Jump to service (Cmd+Shift+O)"
        >
          Jump
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="vai-msg vai-msg-err" onClick={() => setError('')}>
          {error}
        </div>
      )}

      {/* Services table + detail */}
      <div className="vai-body">
        <div className="vai-table-area">
          {loading && <div className="vai-loading">Loading services...</div>}
          {!loading && filteredServices.length === 0 && (
            <div className="empty-state">
              {projects.length === 0
                ? 'Add a project ID above to browse Cloud Run services.'
                : 'No services found for the selected projects and regions.'}
            </div>
          )}
          {!loading && filteredServices.length > 0 && (
            <div className="vai-table-wrapper">
              <table className="vai-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort('name')}>
                      Service {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('project')}>
                      Project {sortColumn === 'project' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('region')}>
                      Region {sortColumn === 'region' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('status')}>
                      Status {sortColumn === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>URL</th>
                    <th className="sortable" onClick={() => handleSort('created')}>
                      Created {sortColumn === 'created' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map((svc) => {
                    const key = `${svc.namespace}/${svc.region}/${svc.name}`;
                    const status = readyStatus(svc);
                    return (
                      <tr
                        key={key}
                        className={`vai-row ${expandedService === key ? 'expanded' : ''}`}
                      >
                        <td
                          className="vai-td-name"
                          onClick={() => setExpandedService(expandedService === key ? null : key)}
                        >
                          {svc.name}
                        </td>
                        <td className="vai-td-region">{svc.namespace}</td>
                        <td className="vai-td-region">{svc.region}</td>
                        <td>
                          <span
                            className={`cr-status cr-status-${status}`}
                          >
                            {status === 'ready' ? '\u2705' : status === 'not-ready' ? '\u274C' : '\u2753'}{' '}
                            {status === 'ready' ? 'Ready' : status === 'not-ready' ? 'Not Ready' : 'Unknown'}
                          </span>
                        </td>
                        <td className="cr-url-cell">
                          {svc.url ? (
                            <button
                              className="vai-link-btn"
                              onClick={() => window.shell.openExternal(svc.url)}
                              title={svc.url}
                            >
                              Open
                            </button>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="vai-td-time">{formatTime(svc.createTime)}</td>
                        <td className="vai-td-links">
                          <button
                            className="vai-link-btn"
                            onClick={() => window.shell.openExternal(consoleUrl(svc, svc.namespace))}
                          >
                            Console
                          </button>
                          <button
                            className="vai-link-btn"
                            onClick={() => window.shell.openExternal(logsUrl(svc, svc.namespace))}
                          >
                            Logs
                          </button>
                          <button
                            className="vai-link-btn"
                            onClick={() => window.shell.openExternal(revisionsUrl(svc, svc.namespace))}
                          >
                            Revisions
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {detail && (
          <div className="vai-detail">
            <div className="vai-detail-header">
              <h3>{detail.name}</h3>
              <button className="vai-detail-close" onClick={() => setExpandedService(null)}>
                &times;
              </button>
            </div>

            <div className="vai-detail-section">
              <h4>Overview</h4>
              <div className="vai-detail-grid">
                <span className="vai-detail-label">Status</span>
                <span>
                  {readyStatus(detail) === 'ready'
                    ? '\u2705 Ready'
                    : readyStatus(detail) === 'not-ready'
                      ? '\u274C Not Ready'
                      : '\u2753 Unknown'}
                </span>
                <span className="vai-detail-label">Project</span>
                <span>{detail.namespace}</span>
                <span className="vai-detail-label">Region</span>
                <span>{detail.region}</span>
                <span className="vai-detail-label">URL</span>
                <span className="vai-detail-mono">
                  {detail.url ? (
                    <button
                      className="vai-link-btn"
                      onClick={() => window.shell.openExternal(detail.url)}
                    >
                      {detail.url}
                    </button>
                  ) : (
                    '-'
                  )}
                </span>
                <span className="vai-detail-label">Ingress</span>
                <span>{detail.ingress}</span>
                <span className="vai-detail-label">Created</span>
                <span>{formatTime(detail.createTime)}</span>
                <span className="vai-detail-label">Creator</span>
                <span className="vai-detail-mono">{detail.creator || '-'}</span>
                <span className="vai-detail-label">Last Modifier</span>
                <span className="vai-detail-mono">{detail.lastModifier || '-'}</span>
                <span className="vai-detail-label">Generation</span>
                <span>{detail.generation}</span>
              </div>
            </div>

            <div className="vai-detail-section">
              <h4>Container</h4>
              <div className="vai-detail-grid">
                <span className="vai-detail-label">Image</span>
                <span className="vai-detail-mono">{detail.containerImage || '-'}</span>
                <span className="vai-detail-label">Port</span>
                <span>{detail.containerPort}</span>
                <span className="vai-detail-label">CPU</span>
                <span>{detail.cpuLimit || '-'}</span>
                <span className="vai-detail-label">Memory</span>
                <span>{detail.memoryLimit || '-'}</span>
                <span className="vai-detail-label">Service Account</span>
                <span className="vai-detail-mono">{detail.serviceAccount || '-'}</span>
              </div>
            </div>

            <div className="vai-detail-section">
              <h4>Scaling</h4>
              <div className="vai-detail-grid">
                <span className="vai-detail-label">Min Instances</span>
                <span>{detail.minInstances}</span>
                <span className="vai-detail-label">Max Instances</span>
                <span>{detail.maxInstances || 'auto'}</span>
              </div>
            </div>

            {detail.traffic.length > 0 && (
              <div className="vai-detail-section">
                <h4>Traffic</h4>
                <div className="cr-traffic-list">
                  {detail.traffic.map((t, i) => (
                    <div key={i} className="cr-traffic-item">
                      <span className="cr-traffic-rev">{t.revisionName}</span>
                      <span className="cr-traffic-pct">{t.percent}%</span>
                      {t.latestRevision && <span className="cr-traffic-latest">latest</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.conditions.length > 0 && (
              <div className="vai-detail-section">
                <h4>Conditions</h4>
                {detail.conditions.map((c, i) => (
                  <div key={i} className="cr-condition">
                    <span className={`cr-condition-status cr-condition-${c.status.toLowerCase()}`}>
                      {c.status === 'True' ? '\u2705' : c.status === 'False' ? '\u274C' : '\u2753'}
                    </span>
                    <span className="cr-condition-type">{c.type}</span>
                    {c.message && <span className="cr-condition-msg">{c.message}</span>}
                  </div>
                ))}
              </div>
            )}

            {detail.env.length > 0 && (
              <div className="vai-detail-section">
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}>
                    Environment Variables ({detail.env.length})
                  </summary>
                  <div className="vai-detail-grid" style={{ marginTop: 8 }}>
                    {detail.env.map((e, i) => (
                      <React.Fragment key={i}>
                        <span className="vai-detail-label">{e.name}</span>
                        <span className="vai-detail-mono">{e.value}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {Object.keys(detail.labels).length > 0 && (
              <div className="vai-detail-section">
                <h4>Labels</h4>
                <div className="vai-detail-grid">
                  {Object.entries(detail.labels).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <span className="vai-detail-label">{k}</span>
                      <span className="vai-detail-mono">{v}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            <div className="vai-detail-section">
              <h4>Quick Links</h4>
              <div className="cr-quick-links">
                <button
                  className="vai-link-btn"
                  onClick={() => window.shell.openExternal(consoleUrl(detail, detail.namespace))}
                >
                  Monitoring
                </button>
                <button
                  className="vai-link-btn"
                  onClick={() => window.shell.openExternal(logsUrl(detail, detail.namespace))}
                >
                  Logs
                </button>
                <button
                  className="vai-link-btn"
                  onClick={() => window.shell.openExternal(revisionsUrl(detail, detail.namespace))}
                >
                  Revisions
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Jump modal */}
      {showJump && (
        <div className="modal-backdrop" onClick={() => setShowJump(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Jump to Service</span>
              <span className="modal-shortcut">Cmd+Shift+O</span>
            </div>
            <div className="modal-note">Supports regex patterns</div>
            <input
              className="modal-input"
              ref={jumpInputRef}
              value={jumpQuery}
              onChange={(e) => {
                setJumpQuery(e.target.value);
                setJumpIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setJumpIndex((i) => Math.min(i + 1, filteredJump.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setJumpIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && filteredJump.length > 0) {
                  e.preventDefault();
                  handleJumpSelect(filteredJump[jumpIndex]);
                } else if (e.key === 'Escape') {
                  setShowJump(false);
                }
              }}
              placeholder="Search services..."
            />
            <div className="modal-list">
              {filteredJump.length === 0 && (
                <div className="modal-empty">
                  {jumpItems.length === 0 ? 'No services loaded yet.' : 'No matching services.'}
                </div>
              )}
              {filteredJump.map((item, i) => (
                <button
                  key={item.key}
                  className={`modal-item ${i === jumpIndex ? 'active' : ''}`}
                  onClick={() => handleJumpSelect(item)}
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

export default CloudRunTab;
