import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { GceInstance, TpuInstance } from '@shared/types';

type ComputeInstance = GceInstance | TpuInstance;

const KNOWN_PROJECTS_KEY = 'better-gcp:gce-known-projects';
const ACTIVE_PROJECTS_KEY = 'better-gcp:gce-active-projects';
const ZONES_KEY = 'better-gcp:gce-zones';

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

function statusEmoji(status: string): string {
  switch (status) {
    case 'RUNNING':
    case 'READY':
      return '\u2705';
    case 'STOPPED':
    case 'TERMINATED':
      return '\u274C';
    case 'STOPPING':
    case 'SUSPENDING':
      return '\u23F8';
    case 'PROVISIONING':
    case 'STAGING':
    case 'CREATING':
      return '\u23F3';
    case 'SUSPENDED':
      return '\u23F8';
    default:
      return '\u2753';
  }
}

function isTpuInstance(inst: ComputeInstance): inst is TpuInstance {
  return inst.isTpu === true;
}

function getInstanceStatus(inst: ComputeInstance): string {
  if (isTpuInstance(inst)) {
    return inst.state;
  }
  return inst.status;
}

function getInstanceMachineType(inst: ComputeInstance): string {
  if (isTpuInstance(inst)) {
    return inst.acceleratorType;
  }
  return inst.machineType;
}

function getInstanceInternalIP(inst: ComputeInstance): string {
  if (isTpuInstance(inst)) {
    return inst.networkEndpoints[0]?.ipAddress ?? '-';
  }
  return inst.internalIP || '-';
}

function getInstanceExternalIP(inst: ComputeInstance): string {
  if (isTpuInstance(inst)) {
    return '-';
  }
  return inst.externalIP || '-';
}

function getSshCommand(inst: ComputeInstance): string {
  const zone = inst.zone;
  const name = inst.name;
  const project = inst.projectId;

  if (isTpuInstance(inst)) {
    return `gcloud compute tpus tpu-vm ssh ${name} --zone=${zone} --project=${project}`;
  }
  return `gcloud compute ssh ${name} --zone=${zone} --project=${project}`;
}

function getAcceleratorType(inst: ComputeInstance): 'CPU' | 'GPU' | 'TPU' {
  if (isTpuInstance(inst)) {
    return 'TPU';
  }
  if (inst.hasGpu) {
    return 'GPU';
  }
  return 'CPU';
}

function consoleUrl(inst: ComputeInstance): string {
  if (isTpuInstance(inst)) {
    return `https://console.cloud.google.com/compute/tpus/detail/${inst.zone}/${inst.name}?project=${inst.projectId}`;
  }
  return `https://console.cloud.google.com/compute/instancesDetail/zones/${inst.zone}/instances/${inst.name}?project=${inst.projectId}`;
}

function logsUrl(inst: ComputeInstance): string {
  if (isTpuInstance(inst)) {
    const query = `resource.type%3D%22tpu.googleapis.com%2FNode%22%0Aresource.labels.node_id%3D%22${inst.name}%22`;
    return `https://console.cloud.google.com/logs/query;query=${query}?project=${inst.projectId}`;
  }
  const id = (inst as GceInstance).id;
  const query = `resource.type%3D%22gce_instance%22%0Aresource.labels.instance_id%3D%22${id}%22`;
  return `https://console.cloud.google.com/logs/query;query=${query}?project=${inst.projectId}`;
}

const AVAILABLE_ZONES = [
  'us-west1-a',
  'us-west1-b',
  'us-west1-c',
  'us-central1-a',
  'us-central1-b',
  'us-central1-c',
  'us-central1-f',
  'us-east1-b',
  'us-east1-c',
  'us-east1-d',
  'asia-northeast1-a',
  'asia-northeast1-b',
  'asia-northeast1-c',
];

type GceTabProps = {
  isActive?: boolean;
};

const GceTab = ({ isActive }: GceTabProps) => {
  const [knownProjects, setKnownProjects] = useState<string[]>(() => readStringList(KNOWN_PROJECTS_KEY));
  const [activeProjects, setActiveProjects] = useState<Set<string>>(() => new Set(readStringList(ACTIVE_PROJECTS_KEY)));
  const [projectInput, setProjectInput] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const projectDropdownRef = React.useRef<HTMLDivElement>(null);
  const [zones, setZones] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(ZONES_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return ['us-west1-a'];
  });
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [zoneSearch, setZoneSearch] = useState('');
  const zoneDropdownRef = React.useRef<HTMLDivElement>(null);
  const [instances, setInstances] = useState<ComputeInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedInstance, setExpandedInstance] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showJump, setShowJump] = useState(false);
  const [jumpQuery, setJumpQuery] = useState('');
  const [jumpIndex, setJumpIndex] = useState(0);
  const jumpInputRef = React.useRef<HTMLInputElement>(null);
  const [sortColumn, setSortColumn] = useState<'name' | 'project' | 'zone' | 'status' | 'machineType' | 'created'>('created');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showSshModal, setShowSshModal] = useState(false);
  const [sshCommand, setSshCommand] = useState('');

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
    setInstances((prev) => prev.filter((i) => i.projectId !== id));
  }, []);

  const toggleZone = useCallback((zone: string) => {
    setZones((prev) => {
      const next = prev.includes(zone)
        ? prev.filter((z) => z !== zone)
        : [...prev, zone];
      writeStringList(ZONES_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setShowProjectDropdown(false);
      }
      if (zoneDropdownRef.current && !zoneDropdownRef.current.contains(e.target as Node)) {
        setShowZoneDropdown(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const fetchInstances = useCallback(async () => {
    if (projects.length === 0 || zones.length === 0) return;
    setLoading(true);
    setError('');
    setExpandedInstance(null);

    try {
      const requests = projects.flatMap((projectId) =>
        zones.map(async (zone) => {
          const res = await window.gce.listInstances({ projectId, zone });
          if (!res.ok) throw new Error(`${projectId}/${zone}: ${res.error}`);
          return res.data.instances;
        })
      );
      const results = await Promise.all(requests);
      const all = results.flat();
      all.sort((a, b) => {
        const ta = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0;
        const tb = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0;
        return tb - ta;
      });
      setInstances(all);
    } catch (err: any) {
      setError(String(err));
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [projects, zones]);

  useEffect(() => {
    if (projects.length > 0) fetchInstances();
  }, [projects, zones, fetchInstances]);

  const filteredInstances = useMemo(() => {
    let filtered = instances;
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      filtered = instances.filter(
        (i) =>
          i.name.toLowerCase().includes(lower) ||
          i.projectId.toLowerCase().includes(lower) ||
          i.zone.toLowerCase().includes(lower) ||
          getInstanceMachineType(i).toLowerCase().includes(lower) ||
          getInstanceInternalIP(i).toLowerCase().includes(lower) ||
          getInstanceExternalIP(i).toLowerCase().includes(lower)
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
          aVal = a.projectId.toLowerCase();
          bVal = b.projectId.toLowerCase();
          break;
        case 'zone':
          aVal = a.zone.toLowerCase();
          bVal = b.zone.toLowerCase();
          break;
        case 'status':
          aVal = getInstanceStatus(a);
          bVal = getInstanceStatus(b);
          break;
        case 'machineType':
          aVal = getInstanceMachineType(a).toLowerCase();
          bVal = getInstanceMachineType(b).toLowerCase();
          break;
        case 'created':
          aVal = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0;
          bVal = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [instances, searchQuery, sortColumn, sortDirection]);

  const jumpItems = useMemo(() => {
    return instances.map((i) => ({
      label: i.name,
      detail: `${i.projectId} / ${i.zone}`,
      key: `${i.projectId}/${i.zone}/${i.name}`,
      instance: i,
    }));
  }, [instances]);

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
    setExpandedInstance(item.key);
  }, []);

  const detail = expandedInstance
    ? instances.find((i) => `${i.projectId}/${i.zone}/${i.name}` === expandedInstance)
    : null;

  const filteredAvailableZones = useMemo(() => {
    if (!zoneSearch) return AVAILABLE_ZONES;
    const lower = zoneSearch.toLowerCase();
    return AVAILABLE_ZONES.filter((z) => z.toLowerCase().includes(lower));
  }, [zoneSearch]);

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
          <button className="secondary-button" onClick={fetchInstances} disabled={loading}>
            Refresh
          </button>
        </div>
        <div className="vai-toolbar-right">
          <div className="cr-project-dropdown" ref={zoneDropdownRef}>
            <button
              className="cr-project-dropdown-trigger"
              onClick={() => {
                setShowZoneDropdown((v) => !v);
                setZoneSearch('');
              }}
            >
              Zones ({zones.length})
              <span className="cr-dropdown-arrow">{showZoneDropdown ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showZoneDropdown && (
              <div className="cr-project-dropdown-menu">
                <input
                  className="cr-project-dropdown-input"
                  placeholder="Search zones..."
                  value={zoneSearch}
                  onChange={(e) => setZoneSearch(e.target.value)}
                  autoFocus
                  style={{ marginBottom: 8 }}
                />
                {filteredAvailableZones.length === 0 && (
                  <div className="cr-project-dropdown-empty">No matching zones.</div>
                )}
                {[...filteredAvailableZones].sort((a, b) => {
                  const aActive = zones.includes(a) ? 0 : 1;
                  const bActive = zones.includes(b) ? 0 : 1;
                  if (aActive !== bActive) return aActive - bActive;
                  return a.localeCompare(b);
                }).map((z) => (
                  <div key={z} className="cr-project-dropdown-item">
                    <button
                      className={`cr-project-dropdown-toggle ${zones.includes(z) ? 'active' : ''}`}
                      onClick={() => toggleZone(z)}
                    >
                      <span className="cr-project-check">
                        {zones.includes(z) ? '\u2705' : '\u2B1C'}
                      </span>
                      <span className="cr-project-id">{z}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="cr-search-bar">
        <input
          className="cr-search-input"
          placeholder="Filter instances by name, project, zone, machine type, or IP..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span className="cr-search-count">
          {filteredInstances.length} instance{filteredInstances.length !== 1 ? 's' : ''}
        </span>
        <button
          className="secondary-button"
          onClick={() => {
            setShowJump(true);
            setJumpQuery('');
            setJumpIndex(0);
            setTimeout(() => jumpInputRef.current?.focus(), 50);
          }}
          title="Jump to instance (Cmd+Shift+O)"
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

      {/* Instances table + detail */}
      <div className="vai-body">
        <div className="vai-table-area">
          {loading && <div className="vai-loading">Loading instances...</div>}
          {!loading && filteredInstances.length === 0 && (
            <div className="empty-state">
              {projects.length === 0
                ? 'Add a project ID above to browse GCE instances.'
                : 'No instances found for the selected projects and zones.'}
            </div>
          )}
          {!loading && filteredInstances.length > 0 && (
            <div className="vai-table-wrapper">
              <table className="vai-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort('name')}>
                      Instance {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('project')}>
                      Project {sortColumn === 'project' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('zone')}>
                      Zone {sortColumn === 'zone' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('status')}>
                      Status {sortColumn === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('machineType')}>
                      Machine Type {sortColumn === 'machineType' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Accelerator</th>
                    <th>Internal IP</th>
                    <th>External IP</th>
                    <th className="sortable" onClick={() => handleSort('created')}>
                      Created {sortColumn === 'created' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInstances.map((inst) => {
                    const key = `${inst.projectId}/${inst.zone}/${inst.name}`;
                    const status = getInstanceStatus(inst);
                    return (
                      <tr
                        key={key}
                        className={`vai-row ${expandedInstance === key ? 'expanded' : ''}`}
                      >
                        <td
                          className="vai-td-name"
                          onClick={() => setExpandedInstance(expandedInstance === key ? null : key)}
                        >
                          {inst.name}
                        </td>
                        <td className="vai-td-region">{inst.projectId}</td>
                        <td className="vai-td-region">{inst.zone}</td>
                        <td>
                          <span className={`cr-status cr-status-${status.toLowerCase()}`}>
                            {statusEmoji(status)} {status}
                          </span>
                        </td>
                        <td className="vai-td-mono">{getInstanceMachineType(inst)}</td>
                        <td>
                          <span className={`gce-accelerator-tag gce-accelerator-${getAcceleratorType(inst).toLowerCase()}`}>
                            {getAcceleratorType(inst)}
                          </span>
                        </td>
                        <td className="vai-td-mono">{getInstanceInternalIP(inst)}</td>
                        <td className="vai-td-mono">{getInstanceExternalIP(inst)}</td>
                        <td className="vai-td-time">{formatTime(inst.creationTimestamp)}</td>
                        <td className="vai-td-links">
                          <button
                            className="vai-link-btn"
                            onClick={() => {
                              setSshCommand(getSshCommand(inst));
                              setShowSshModal(true);
                            }}
                          >
                            SSH
                          </button>
                          <button
                            className="vai-link-btn"
                            onClick={() => window.shell.openExternal(consoleUrl(inst))}
                          >
                            Console
                          </button>
                          <button
                            className="vai-link-btn"
                            onClick={() => window.shell.openExternal(logsUrl(inst))}
                          >
                            Logs
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
              <button className="vai-detail-close" onClick={() => setExpandedInstance(null)}>
                &times;
              </button>
            </div>

            <div className="vai-detail-section">
              <h4>Overview</h4>
              <div className="vai-detail-grid">
                <span className="vai-detail-label">Status</span>
                <span>{statusEmoji(getInstanceStatus(detail))} {getInstanceStatus(detail)}</span>
                <span className="vai-detail-label">Project</span>
                <span>{detail.projectId}</span>
                <span className="vai-detail-label">Zone</span>
                <span>{detail.zone}</span>
                <span className="vai-detail-label">Accelerator</span>
                <span>
                  <span className={`gce-accelerator-tag gce-accelerator-${getAcceleratorType(detail).toLowerCase()}`}>
                    {getAcceleratorType(detail)}
                  </span>
                  {!isTpuInstance(detail) && detail.hasGpu && detail.gpuType && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>
                      {detail.gpuCount}x {detail.gpuType}
                    </span>
                  )}
                  {isTpuInstance(detail) && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>
                      {detail.acceleratorType}
                    </span>
                  )}
                </span>
                <span className="vai-detail-label">{isTpuInstance(detail) ? 'Accelerator Type' : 'Machine Type'}</span>
                <span className="vai-detail-mono">{getInstanceMachineType(detail)}</span>
                {!isTpuInstance(detail) && (
                  <>
                    <span className="vai-detail-label">CPU Platform</span>
                    <span>{detail.cpuPlatform || '-'}</span>
                    <span className="vai-detail-label">Instance ID</span>
                    <span className="vai-detail-mono">{detail.id}</span>
                  </>
                )}
                {isTpuInstance(detail) && (
                  <>
                    <span className="vai-detail-label">Runtime Version</span>
                    <span>{detail.runtimeVersion}</span>
                  </>
                )}
                <span className="vai-detail-label">Created</span>
                <span>{formatTime(detail.creationTimestamp)}</span>
              </div>
            </div>

            {detail.description && (
              <div className="vai-detail-section">
                <h4>Description</h4>
                <p>{detail.description}</p>
              </div>
            )}

            <div className="vai-detail-section">
              <h4>Network</h4>
              <div className="vai-detail-grid">
                <span className="vai-detail-label">Internal IP</span>
                <span className="vai-detail-mono">{getInstanceInternalIP(detail)}</span>
                {!isTpuInstance(detail) && (
                  <>
                    <span className="vai-detail-label">External IP</span>
                    <span className="vai-detail-mono">{getInstanceExternalIP(detail)}</span>
                    <span className="vai-detail-label">IP Forwarding</span>
                    <span>{detail.canIpForward ? 'Enabled' : 'Disabled'}</span>
                  </>
                )}
                {isTpuInstance(detail) && detail.cidrBlock && (
                  <>
                    <span className="vai-detail-label">CIDR Block</span>
                    <span className="vai-detail-mono">{detail.cidrBlock}</span>
                  </>
                )}
              </div>
            </div>

            {!isTpuInstance(detail) && detail.networkInterfaces.length > 0 && (
              <div className="vai-detail-section">
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}>
                    Network Interfaces ({detail.networkInterfaces.length})
                  </summary>
                  {detail.networkInterfaces.map((iface, i) => (
                    <div key={i} className="vai-detail-grid" style={{ marginTop: 8 }}>
                      <span className="vai-detail-label">Network</span>
                      <span className="vai-detail-mono">{iface.network.split('/').pop()}</span>
                      <span className="vai-detail-label">Internal IP</span>
                      <span className="vai-detail-mono">{iface.networkIP}</span>
                      {iface.accessConfigs.map((ac, j) => (
                        <React.Fragment key={j}>
                          <span className="vai-detail-label">External IP ({ac.name})</span>
                          <span className="vai-detail-mono">{ac.natIP || '-'}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  ))}
                </details>
              </div>
            )}

            <div className="vai-detail-section">
              <h4>Security</h4>
              <div className="vai-detail-grid">
                <span className="vai-detail-label">Service Account</span>
                <span className="vai-detail-mono">{detail.serviceAccount || '-'}</span>
              </div>
            </div>

            {!isTpuInstance(detail) && (detail as GceInstance).tags.length > 0 && (
              <div className="vai-detail-section">
                <h4>Network Tags</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(detail as GceInstance).tags.map((tag: string, i: number) => (
                    <span key={i} className="vai-detail-mono" style={{ fontSize: 11, padding: '2px 6px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3 }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!isTpuInstance(detail) && (detail as GceInstance).disks.length > 0 && (
              <div className="vai-detail-section">
                <h4>Disks</h4>
                {(detail as GceInstance).disks.map((disk: any, i: number) => (
                  <div key={i} className="vai-detail-grid" style={{ marginBottom: i < (detail as GceInstance).disks.length - 1 ? 8 : 0 }}>
                    <span className="vai-detail-label">Device Name</span>
                    <span className="vai-detail-mono">{disk.deviceName}</span>
                    <span className="vai-detail-label">Source</span>
                    <span className="vai-detail-mono">{disk.source.split('/').pop()}</span>
                    <span className="vai-detail-label">Mode</span>
                    <span>{disk.mode}</span>
                    <span className="vai-detail-label">Boot</span>
                    <span>{disk.boot ? 'Yes' : 'No'}</span>
                  </div>
                ))}
              </div>
            )}

            {!isTpuInstance(detail) && (
              <div className="vai-detail-section">
                <h4>Scheduling</h4>
                <div className="vai-detail-grid">
                  <span className="vai-detail-label">Automatic Restart</span>
                  <span>{(detail as GceInstance).scheduling.automaticRestart ? 'Enabled' : 'Disabled'}</span>
                  <span className="vai-detail-label">On Host Maintenance</span>
                  <span>{(detail as GceInstance).scheduling.onHostMaintenance || '-'}</span>
                  <span className="vai-detail-label">Preemptible</span>
                  <span>{(detail as GceInstance).scheduling.preemptible ? 'Yes' : 'No'}</span>
                </div>
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

            {!isTpuInstance(detail) && (detail as GceInstance).metadata.length > 0 && (
              <div className="vai-detail-section">
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}>
                    Metadata ({(detail as GceInstance).metadata.length})
                  </summary>
                  <div className="vai-detail-grid" style={{ marginTop: 8 }}>
                    {(detail as GceInstance).metadata.map((m: any, i: number) => (
                      <React.Fragment key={i}>
                        <span className="vai-detail-label">{m.key}</span>
                        <span className="vai-detail-mono" style={{ wordBreak: 'break-all' }}>{m.value}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {!isTpuInstance(detail) && (detail as GceInstance).scopes.length > 0 && (
              <div className="vai-detail-section">
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}>
                    Access Scopes ({(detail as GceInstance).scopes.length})
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    {(detail as GceInstance).scopes.map((scope: string, i: number) => (
                      <div key={i} className="vai-detail-mono" style={{ fontSize: 11, marginBottom: 4 }}>
                        {scope}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            <div className="vai-detail-section">
              <h4>Quick Links</h4>
              <div className="cr-quick-links">
                <button
                  className="vai-link-btn"
                  onClick={() => window.shell.openExternal(consoleUrl(detail))}
                >
                  Console
                </button>
                <button
                  className="vai-link-btn"
                  onClick={() => window.shell.openExternal(logsUrl(detail))}
                >
                  Logs
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SSH Command Modal */}
      {showSshModal && (
        <div className="modal-backdrop" onClick={() => setShowSshModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <span className="modal-title">SSH Command</span>
              <button className="vai-detail-close" onClick={() => setShowSshModal(false)}>
                &times;
              </button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p style={{ marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}>
                Copy and run this command in your terminal:
              </p>
              <div
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '12px 14px',
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: 13,
                  wordBreak: 'break-all',
                  userSelect: 'all',
                  cursor: 'text',
                }}
              >
                {sshCommand}
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="secondary-button"
                  onClick={() => {
                    navigator.clipboard.writeText(sshCommand);
                  }}
                >
                  Copy to Clipboard
                </button>
                <button
                  className="primary-button"
                  onClick={() => setShowSshModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jump modal */}
      {showJump && (
        <div className="modal-backdrop" onClick={() => setShowJump(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Jump to Instance</span>
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
              placeholder="Search instances..."
            />
            <div className="modal-list">
              {filteredJump.length === 0 && (
                <div className="modal-empty">
                  {jumpItems.length === 0 ? 'No instances loaded yet.' : 'No matching instances.'}
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

export default GceTab;
