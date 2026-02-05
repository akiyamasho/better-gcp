import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GcsBucket, ListObjectsResponse } from '@shared/types';

type Item = {
  type: 'prefix' | 'file';
  name: string;
  displayName: string;
  size?: number;
  updated?: string;
  storageClass?: string;
};

type MenuItem = {
  label: string;
  action: () => void;
  disabled?: boolean;
};

type HistoryEntry = {
  bucket: string;
  prefix: string;
};

type TreeNodeState = {
  children: string[];
  loaded: boolean;
  loading: boolean;
};

type SearchEntry = {
  type: 'prefix' | 'file';
  name: string;
  label: string;
  detail: string;
};

const RECENT_STORAGE_KEY = 'better-gcs:recent';
const FAVORITES_STORAGE_KEY = 'better-gcs:favorites';
const RECENT_LIMIT = 8;

const formatBytes = (size: number) => {
  if (!Number.isFinite(size)) return '-';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size;
  let idx = -1;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[idx]}`;
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const normalizePrefix = (prefix: string) => {
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
};

const formatGsPath = (bucket: string, prefix: string) => {
  if (!bucket) return 'gs://';
  return `gs://${bucket}/${prefix || ''}`;
};

const parseGsPath = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed.startsWith('gs://')) return null;
  const rest = trimmed.slice('gs://'.length);
  if (!rest) return null;
  const parts = rest.split('/');
  const bucket = parts.shift() ?? '';
  if (!bucket) return null;
  const rawPrefix = parts.join('/');
  const prefix = rawPrefix ? normalizePrefix(rawPrefix) : '';
  return { bucket, prefix };
};

const buildGsutilCopy = (bucket: string, name: string, isPrefix: boolean) => {
  if (isPrefix) {
    return `gsutil -m cp -r "gs://${bucket}/${name}" .`;
  }
  return `gsutil cp "gs://${bucket}/${name}" .`;
};

const buildGsutilList = (bucket: string, name: string) => `gsutil ls "gs://${bucket}/${name}"`;

const buildGsutilRsync = (bucket: string, name: string) =>
  `gsutil -m rsync -r "gs://${bucket}/${name}" ./`;

const readStoredList = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [] as string[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as string[];
    return parsed.filter((item) => typeof item === 'string');
  } catch {
    return [] as string[];
  }
};

const writeStoredList = (key: string, value: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors (e.g., private mode).
  }
};

const getPrefixLabel = (prefix: string, parent: string) => {
  const trimmed = prefix.startsWith(parent) ? prefix.slice(parent.length) : prefix;
  return trimmed.replace(/\/$/, '') || prefix;
};

const App = () => {
  const [buckets, setBuckets] = useState<GcsBucket[]>([]);
  const [currentBucket, setCurrentBucket] = useState('');
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [listing, setListing] = useState<ListObjectsResponse>({ prefixes: [], files: [] });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pathInput, setPathInput] = useState('gs://');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [favoriteBuckets, setFavoriteBuckets] = useState<string[]>([]);
  const [recentBuckets, setRecentBuckets] = useState<string[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [showTree, setShowTree] = useState(true);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [showAddFavorite, setShowAddFavorite] = useState(false);
  const [newFavoriteName, setNewFavoriteName] = useState('');
  const [treeNodes, setTreeNodes] = useState<Record<string, TreeNodeState>>({});
  const [expandedPrefixes, setExpandedPrefixes] = useState<Record<string, boolean>>({ '': true });
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [showPathModal, setShowPathModal] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(
    null
  );
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFavoriteBuckets(readStoredList(FAVORITES_STORAGE_KEY));
    setRecentBuckets(readStoredList(RECENT_STORAGE_KEY));
    setStorageLoaded(true);
  }, []);

  useEffect(() => {
    if (!storageLoaded) return;
    writeStoredList(FAVORITES_STORAGE_KEY, favoriteBuckets);
  }, [favoriteBuckets, storageLoaded]);

  useEffect(() => {
    if (!storageLoaded) return;
    writeStoredList(RECENT_STORAGE_KEY, recentBuckets);
  }, [recentBuckets, storageLoaded]);

  useEffect(() => {
    let mounted = true;
    window.gcs
      .listBuckets()
      .then((data) => {
        if (!mounted) return;
        setBuckets(data);
        if (!currentBucket && data.length > 0) {
          navigate(data[0].name, '', true);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setError(String(err));
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!storageLoaded || !currentBucket) return;
    setRecentBuckets((prev) => {
      const next = [currentBucket, ...prev.filter((bucket) => bucket !== currentBucket)];
      return next.slice(0, RECENT_LIMIT);
    });
  }, [currentBucket, storageLoaded]);

  useEffect(() => {
    if (!currentBucket) return;
    setLoading(true);
    setError('');
    window.gcs
      .listObjects({ bucket: currentBucket, prefix: currentPrefix, delimiter: '/' })
      .then((data) => {
        setListing(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [currentBucket, currentPrefix]);

  useEffect(() => {
    setPathInput(formatGsPath(currentBucket, currentPrefix));
  }, [currentBucket, currentPrefix]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    if (!showSearch) return;
    searchInputRef.current?.focus();
    setSearchIndex(0);
  }, [showSearch]);

  useEffect(() => {
    if (!showPathModal) return;
    pathInputRef.current?.focus();
  }, [showPathModal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      const isMeta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (isMeta && event.altKey && key === 'o') {
        event.preventDefault();
        openSearch();
      }
      if (isMeta && event.shiftKey && key === 'p') {
        event.preventDefault();
        openPathModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentBucket, currentPrefix]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showSearch) setShowSearch(false);
      if (showPathModal) setShowPathModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showSearch, showPathModal]);

  const ensureTreeLoaded = async (bucket: string, prefix: string, force = false) => {
    if (!bucket) return;
    if (!force && (treeNodes[prefix]?.loading || treeNodes[prefix]?.loaded)) return;
    setTreeNodes((prev) => ({
      ...prev,
      [prefix]: {
        children: prev[prefix]?.children ?? [],
        loaded: false,
        loading: true,
      },
    }));
    try {
      const data = await window.gcs.listObjects({ bucket, prefix, delimiter: '/' });
      setTreeNodes((prev) => ({
        ...prev,
        [prefix]: {
          children: data.prefixes,
          loaded: true,
          loading: false,
        },
      }));
    } catch (err) {
      setError(String(err));
      setTreeNodes((prev) => ({
        ...prev,
        [prefix]: {
          children: prev[prefix]?.children ?? [],
          loaded: false,
          loading: false,
        },
      }));
    }
  };

  useEffect(() => {
    if (!currentBucket) return;
    setTreeNodes({});
    setExpandedPrefixes({ '': true });
    ensureTreeLoaded(currentBucket, '', true);
  }, [currentBucket]);

  useEffect(() => {
    if (!currentBucket) return;
    const parts = currentPrefix.split('/').filter(Boolean);
    const nextExpanded: Record<string, boolean> = { '': true };
    const prefixesToLoad: string[] = [''];
    let path = '';
    for (const part of parts) {
      path = `${path}${part}/`;
      nextExpanded[path] = true;
      prefixesToLoad.push(path);
    }
    setExpandedPrefixes((prev) => ({ ...prev, ...nextExpanded }));
    prefixesToLoad.forEach((prefix) => ensureTreeLoaded(currentBucket, prefix));
  }, [currentBucket, currentPrefix]);

  useEffect(() => {
    if (!pendingSelection) return;
    const found = listing.files.find((file) => `file:${file.name}` === pendingSelection);
    if (!found) return;
    setSelectedKey(`file:${found.name}`);
    setPendingSelection(null);
  }, [listing, pendingSelection]);

  const toggleFavorite = (bucketName: string) => {
    setFavoriteBuckets((prev) => {
      if (prev.includes(bucketName)) {
        return prev.filter((bucket) => bucket !== bucketName);
      }
      return [bucketName, ...prev];
    });
  };

  const addFavorite = (bucketName: string) => {
    const trimmed = bucketName.trim();
    if (!trimmed) return;
    setFavoriteBuckets((prev) => [trimmed, ...prev.filter((bucket) => bucket !== trimmed)]);
  };

  const toggleTreePrefix = (prefix: string) => {
    const next = !expandedPrefixes[prefix];
    setExpandedPrefixes((prev) => ({ ...prev, [prefix]: next }));
    if (next && currentBucket) {
      ensureTreeLoaded(currentBucket, prefix);
    }
  };

  const bucketMap = useMemo(() => {
    return new Map(buckets.map((bucket) => [bucket.name, bucket]));
  }, [buckets]);

  const searchEntries = useMemo<SearchEntry[]>(() => {
    if (!currentBucket) return [];
    const entries: SearchEntry[] = [];
    const prefixSet = new Set<string>();
    Object.values(treeNodes).forEach((node) => {
      node.children.forEach((prefix) => prefixSet.add(prefix));
    });
    prefixSet.forEach((prefix) => {
      entries.push({
        type: 'prefix',
        name: prefix,
        label: getPrefixLabel(prefix, ''),
        detail: `gs://${currentBucket}/${prefix}`,
      });
    });
    listing.files.forEach((file) => {
      entries.push({
        type: 'file',
        name: file.name,
        label: file.name.split('/').slice(-1)[0] || file.name,
        detail: `gs://${currentBucket}/${file.name}`,
      });
    });
    return entries;
  }, [currentBucket, listing.files, treeNodes]);

  const filteredSearchEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = !query
      ? searchEntries
      : searchEntries.filter(
          (entry) =>
            entry.detail.toLowerCase().includes(query) || entry.label.toLowerCase().includes(query)
        );
    return filtered.slice(0, 200);
  }, [searchEntries, searchQuery]);

  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    setSearchIndex((prev) => Math.min(prev, Math.max(filteredSearchEntries.length - 1, 0)));
  }, [filteredSearchEntries.length]);

  const openSearch = () => {
    setShowSearch(true);
    setSearchQuery('');
    setSearchIndex(0);
  };

  const openPathModal = () => {
    setShowPathModal(true);
    setPathInput(formatGsPath(currentBucket, currentPrefix));
  };

  const handleSearchSelect = (entry: SearchEntry) => {
    if (!currentBucket) return;
    if (entry.type === 'prefix') {
      navigate(currentBucket, entry.name, true);
    } else {
      const parts = entry.name.split('/');
      const fileName = parts.pop() ?? entry.name;
      const parent = parts.length ? `${parts.join('/')}/` : '';
      navigate(currentBucket, parent, true);
      setPendingSelection(`file:${parts.length ? `${parts.join('/')}/` : ''}${fileName}`);
    }
    setShowSearch(false);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredSearchEntries.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSearchIndex((prev) => Math.min(prev + 1, filteredSearchEntries.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSearchIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = filteredSearchEntries[searchIndex];
      if (entry) handleSearchSelect(entry);
    }
  };

  const items = useMemo<Item[]>(() => {
    const prefixItems = listing.prefixes.map((name) => {
      const trimmed = name.startsWith(currentPrefix) ? name.slice(currentPrefix.length) : name;
      const displayName = trimmed.replace(/\/$/, '');
      return {
        type: 'prefix' as const,
        name,
        displayName: displayName || name,
      };
    });
    const fileItems = listing.files.map((file) => {
      const displayName = file.name.startsWith(currentPrefix)
        ? file.name.slice(currentPrefix.length)
        : file.name;
      return {
        type: 'file' as const,
        name: file.name,
        displayName: displayName || file.name,
        size: file.size,
        updated: file.updated,
        storageClass: file.storageClass,
      };
    });
    return [...prefixItems, ...fileItems].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'prefix' ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [listing, currentPrefix]);

  const fileNames = useMemo(
    () => items.filter((item) => item.type === 'file').map((item) => item.name),
    [items]
  );
  const allSelected = fileNames.length > 0 && fileNames.every((name) => selectedFiles.has(name));
  const someSelected = fileNames.some((name) => selectedFiles.has(name)) && !allSelected;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  useEffect(() => {
    setSelectedFiles(new Set());
  }, [currentBucket, currentPrefix]);

  const breadcrumbs = useMemo(() => {
    if (!currentBucket) return [] as { label: string; bucket: string; prefix: string }[];
    const parts = currentPrefix.split('/').filter(Boolean);
    const crumbs: { label: string; bucket: string; prefix: string }[] = [
      { label: currentBucket, bucket: currentBucket, prefix: '' },
    ];
    parts.forEach((part, index) => {
      const prefix = `${parts.slice(0, index + 1).join('/')}/`;
      crumbs.push({ label: part, bucket: currentBucket, prefix });
    });
    return crumbs;
  }, [currentBucket, currentPrefix]);

  const navigate = (bucket: string, prefix: string, pushHistory = true) => {
    const normalizedPrefix = prefix ?? '';
    setCurrentBucket(bucket);
    setCurrentPrefix(normalizedPrefix);
    setSelectedKey(null);
    if (pushHistory) {
      const next = { bucket, prefix: normalizedPrefix };
      const newHistory = history.slice(0, historyIndex + 1).concat(next);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;

  const goBack = () => {
    if (!canGoBack) return;
    const nextIndex = historyIndex - 1;
    const entry = history[nextIndex];
    setHistoryIndex(nextIndex);
    setCurrentBucket(entry.bucket);
    setCurrentPrefix(entry.prefix);
  };

  const goForward = () => {
    if (!canGoForward) return;
    const nextIndex = historyIndex + 1;
    const entry = history[nextIndex];
    setHistoryIndex(nextIndex);
    setCurrentBucket(entry.bucket);
    setCurrentPrefix(entry.prefix);
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Copied to clipboard');
      setTimeout(() => setStatus(''), 1200);
    } catch (err) {
      setError(String(err));
    }
  };

  const openItemMenu = (event: React.MouseEvent, item: Item) => {
    event.preventDefault();
    event.stopPropagation();
    const gsPath = `gs://${currentBucket}/${item.name}`;
    const isPrefix = item.type === 'prefix';
    const canDelete = item.type === 'file';
    const items: MenuItem[] = [
      {
        label: 'Copy gs:// path',
        action: () => copyText(gsPath),
      },
      {
        label: 'Copy gsutil cp command',
        action: () => copyText(buildGsutilCopy(currentBucket, item.name, isPrefix)),
      },
      {
        label: 'Copy gsutil ls command',
        action: () => copyText(buildGsutilList(currentBucket, item.name)),
        disabled: !isPrefix,
      },
      {
        label: 'Copy gsutil rsync command',
        action: () => copyText(buildGsutilRsync(currentBucket, item.name)),
        disabled: !isPrefix,
      },
      {
        label: 'Download...',
        action: () => handleDownload(item),
      },
      {
        label: 'Delete',
        action: () => handleDelete([item.name]),
        disabled: !canDelete,
      },
    ];
    setContextMenu({ x: event.clientX, y: event.clientY, items });
  };

  const openBackgroundMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (!currentBucket) return;
    const gsPath = formatGsPath(currentBucket, currentPrefix);
    const items: MenuItem[] = [
      {
        label: 'Copy current path',
        action: () => copyText(gsPath),
      },
      {
        label: 'Create folder...',
        action: () => handleCreateFolder(),
      },
      {
        label: 'Upload files or folders...',
        action: () => handleChooseUpload(),
      },
    ];
    setContextMenu({ x: event.clientX, y: event.clientY, items });
  };

  const handleCreateFolder = async () => {
    if (!currentBucket) return;
    const name = window.prompt('Folder name');
    if (!name) return;
    const result = await window.gcs.createFolder({
      bucket: currentBucket,
      prefix: currentPrefix,
      name,
    });
    if (!result.ok) {
      setError(result.error ?? 'Create folder failed');
      return;
    }
    const data = await window.gcs.listObjects({
      bucket: currentBucket,
      prefix: currentPrefix,
      delimiter: '/',
    });
    setListing(data);
  };

  const handleDownload = async (item: Item) => {
    if (!currentBucket) return;
    setStatus('Preparing download...');
    const result = await window.gcs.download({
      bucket: currentBucket,
      name: item.name,
      isPrefix: item.type === 'prefix',
    });
    if ('error' in result && result.error) {
      setError(result.error);
    }
    if (!result.canceled) {
      setStatus('Download complete');
      setTimeout(() => setStatus(''), 1500);
    } else {
      setStatus('');
    }
  };

  const handleBatchDownload = async (names: string[]) => {
    if (!currentBucket || names.length === 0) return;
    setStatus('Preparing downloads...');
    const result = await window.gcs.downloadMany({
      bucket: currentBucket,
      names,
      basePrefix: currentPrefix,
    });
    if ('error' in result && result.error) {
      setError(result.error);
    }
    if (!result.canceled) {
      setStatus('Downloads complete');
      setTimeout(() => setStatus(''), 1500);
    } else {
      setStatus('');
    }
  };

  const handleChooseUpload = async () => {
    if (!currentBucket) return;
    const result = await window.gcs.chooseUpload();
    if (!result.canceled && result.paths.length > 0) {
      await handleUpload(result.paths, currentPrefix);
    }
  };

  const handleUpload = async (paths: string[], prefix: string) => {
    if (!currentBucket) return;
    setStatus('Uploading...');
    const result = await window.gcs.upload({ bucket: currentBucket, prefix, paths });
    if (!result.ok) {
      setError(result.error ?? 'Upload failed');
    } else {
      setStatus('Upload complete');
      setTimeout(() => setStatus(''), 1500);
      const data = await window.gcs.listObjects({
        bucket: currentBucket,
        prefix: currentPrefix,
        delimiter: '/',
      });
      setListing(data);
    }
  };

  const handlePathSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    submitPath();
  };

  const submitPath = () => {
    const parsed = parseGsPath(pathInput);
    if (!parsed) {
      setError('Enter a path like gs://bucket/prefix/');
      return;
    }
    setError('');
    setShowPathModal(false);
    navigate(parsed.bucket, parsed.prefix, true);
  };

  const handleDelete = async (names: string[]) => {
    if (!currentBucket || names.length === 0) return;
    const confirmed = window.confirm(`Delete ${names.length} file${names.length === 1 ? '' : 's'}?`);
    if (!confirmed) return;
    setStatus('Deleting...');
    const result = await window.gcs.delete({ bucket: currentBucket, names });
    if (!result.ok) {
      setError(result.error ?? 'Delete failed');
    } else {
      setStatus('Deleted');
      setTimeout(() => setStatus(''), 1200);
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        names.forEach((name) => next.delete(name));
        return next;
      });
      const data = await window.gcs.listObjects({
        bucket: currentBucket,
        prefix: currentPrefix,
        delimiter: '/',
      });
      setListing(data);
    }
  };

  const handleDrop = async (event: React.DragEvent, overridePrefix?: string) => {
    event.preventDefault();
    setIsDraggingOver(false);
    if (!currentBucket) return;
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((value): value is string => Boolean(value));
    if (paths.length === 0) return;
    await handleUpload(paths, overridePrefix ?? currentPrefix);
  };

  const handleDragStart = async (event: React.DragEvent, item: Item) => {
    if (item.type !== 'file') return;
    event.dataTransfer.effectAllowed = 'copy';
    const result = await window.gcs.startDrag({ bucket: currentBucket, name: item.name });
    if (!result.ok) {
      setError(result.error ?? 'Drag failed');
    }
  };

  const renderTreeChildren = (parentPrefix: string, depth: number): React.ReactNode => {
    const node = treeNodes[parentPrefix];
    if (!node) return null;
    if (node.loading && node.children.length === 0) {
      return (
        <div className="tree-loading" style={{ paddingLeft: depth * 14 + 24 }}>
          Loading...
        </div>
      );
    }
    if (node.loaded && node.children.length === 0) {
      return (
        <div className="tree-empty" style={{ paddingLeft: depth * 14 + 24 }}>
          No subfolders
        </div>
      );
    }
    return node.children.map((childPrefix) => {
      const childNode = treeNodes[childPrefix];
      const isExpanded = Boolean(expandedPrefixes[childPrefix]);
      const hasChildren = Boolean(childNode?.children.length);
      const canExpand = !childNode?.loaded || hasChildren;
      return (
        <div key={childPrefix}>
          <div
            className={`tree-row ${currentPrefix === childPrefix ? 'active' : ''}`}
            style={{ paddingLeft: depth * 14 }}
          >
            <button
              className="tree-toggle"
              onClick={() => toggleTreePrefix(childPrefix)}
              disabled={!canExpand}
            >
              {isExpanded ? '-' : '+'}
            </button>
            <button className="tree-label" onClick={() => navigate(currentBucket, childPrefix, true)}>
              {getPrefixLabel(childPrefix, parentPrefix)}
            </button>
          </div>
          {isExpanded ? renderTreeChildren(childPrefix, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">Better GCS</div>
          <div className="subhead">Finder-style cloud browser</div>
        </div>
        <div className="sidebar-section">
          <button className="section-toggle" onClick={() => setShowTree((prev) => !prev)}>
            <span>Directory Tree</span>
            <span className="section-icon">{showTree ? '-' : '+'}</span>
          </button>
          {showTree ? (
            <div className="tree">
              {currentBucket ? (
                <>
                  <div className={`tree-row ${currentPrefix === '' ? 'active' : ''}`}>
                    <button className="tree-toggle" onClick={() => toggleTreePrefix('')}>
                      {expandedPrefixes[''] ? '-' : '+'}
                    </button>
                    <button className="tree-label" onClick={() => navigate(currentBucket, '', true)}>
                      {currentBucket}
                    </button>
                  </div>
                  {expandedPrefixes[''] ? renderTreeChildren('', 1) : null}
                </>
              ) : (
                <div className="list-empty">Select a bucket to see the tree.</div>
              )}
            </div>
          ) : null}
        </div>
        <div className="sidebar-section">
          <div className="section-header">
            <button
              className="section-toggle"
              onClick={() => {
                setShowFavorites((prev) => !prev);
                if (showFavorites) setShowAddFavorite(false);
              }}
            >
              <span>Favorites</span>
              <span className="section-icon">{showFavorites ? '-' : '+'}</span>
            </button>
            <button
              className="section-add"
              onClick={() => {
                setShowFavorites(true);
                setShowAddFavorite(true);
              }}
              aria-label="Add favorite bucket"
            >
              +
            </button>
          </div>
          {showFavorites ? (
            <div className="bucket-list compact">
              {showAddFavorite ? (
                <form
                  className="favorite-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addFavorite(newFavoriteName);
                    setNewFavoriteName('');
                    setShowAddFavorite(false);
                  }}
                >
                  <input
                    className="favorite-input"
                    value={newFavoriteName}
                    onChange={(event) => setNewFavoriteName(event.target.value)}
                    placeholder="bucket-name"
                  />
                  <button className="tiny-action" type="submit">
                    Add
                  </button>
                </form>
              ) : null}
              {favoriteBuckets.length === 0 ? (
                <div className="list-empty">No favorites yet.</div>
              ) : (
                favoriteBuckets.map((name) => {
                  const bucket = bucketMap.get(name);
                  return (
                    <div key={name} className="bucket-row">
                      <button className="bucket-link" onClick={() => navigate(name, '', true)}>
                        <span className="bucket-name">{name}</span>
                        {bucket?.location ? <span className="bucket-meta">{bucket.location}</span> : null}
                      </button>
                      <button
                        className="favorite-toggle compact active"
                        onClick={() => toggleFavorite(name)}
                        aria-label="Toggle favorite"
                      >
                        *
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
        <div className="sidebar-section">
          <button className="section-toggle" onClick={() => setShowRecent((prev) => !prev)}>
            <span>Recent</span>
            <span className="section-icon">{showRecent ? '-' : '+'}</span>
          </button>
          {showRecent ? (
            <div className="bucket-list compact">
              {recentBuckets.length === 0 ? (
                <div className="list-empty">No recent buckets.</div>
              ) : (
                recentBuckets.map((name) => {
                  const bucket = bucketMap.get(name);
                  const isFavorite = favoriteBuckets.includes(name);
                  return (
                    <div key={name} className="bucket-row">
                      <button className="bucket-link" onClick={() => navigate(name, '', true)}>
                        <span className="bucket-name">{name}</span>
                        {bucket?.location ? <span className="bucket-meta">{bucket.location}</span> : null}
                      </button>
                      <button
                        className={`favorite-toggle compact ${isFavorite ? 'active' : ''}`}
                        onClick={() => toggleFavorite(name)}
                        aria-label="Toggle favorite"
                      >
                        *
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </aside>

      <main className="main">
        <header className="toolbar">
          <div className="nav-controls">
            <button className="icon-button" onClick={goBack} disabled={!canGoBack}>
              &lt;
            </button>
            <button className="icon-button" onClick={goForward} disabled={!canGoForward}>
              &gt;
            </button>
          </div>
          <div className="breadcrumbs">
            {breadcrumbs.length === 0 ? (
              <span className="breadcrumb-muted">Select a bucket to begin</span>
            ) : (
              breadcrumbs.map((crumb, index) => (
                <button
                  key={`${crumb.bucket}-${crumb.prefix}`}
                  className="breadcrumb"
                  onClick={() => navigate(crumb.bucket, crumb.prefix, true)}
                >
                  {crumb.label}
                  {index < breadcrumbs.length - 1 ? <span className="breadcrumb-sep">/</span> : null}
                </button>
              ))
            )}
          </div>
          <div className="toolbar-actions">
            <button className="secondary-button" onClick={openSearch}>
              Quick Open
            </button>
            <button className="primary-button" onClick={openPathModal}>
              Go to path...
            </button>
          </div>
        </header>

        <section
          className={`content ${isDraggingOver ? 'dragging' : ''}`}
          onContextMenu={openBackgroundMenu}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(event) => handleDrop(event)}
        >
          {selectedFiles.size > 0 ? (
            <div className="batch-bar">
              <span>{selectedFiles.size} selected</span>
              <div className="batch-actions">
                <button
                  className="secondary-button"
                  onClick={() => handleBatchDownload(Array.from(selectedFiles))}
                >
                  Download
                </button>
                <button className="danger-button" onClick={() => handleDelete(Array.from(selectedFiles))}>
                  Delete
                </button>
              </div>
            </div>
          ) : null}
          <div className="list-header">
            <div className="col-name">
              <input
                ref={selectAllRef}
                className="row-check"
                type="checkbox"
                checked={allSelected}
                onChange={(event) => {
                  event.stopPropagation();
                  if (event.target.checked) {
                    setSelectedFiles(new Set(fileNames));
                  } else {
                    setSelectedFiles(new Set());
                  }
                }}
                onClick={(event) => event.stopPropagation()}
              />
              <span className="col-check">Select</span>
              <span>Name</span>
            </div>
            <div className="col-size">Size</div>
            <div className="col-updated">Updated</div>
            <div className="col-actions">Actions</div>
          </div>
          <div className="list-body">
            {loading ? (
              <div className="empty-state">Loading objects...</div>
            ) : items.length === 0 ? (
              <div className="empty-state">No objects found in this prefix.</div>
            ) : (
              items.map((item, index) => {
                const key = `${item.type}:${item.name}`;
                const selected = key === selectedKey;
                const isChecked = item.type === 'file' && selectedFiles.has(item.name);
                return (
                  <div
                    key={key}
                    className={`list-row ${selected ? 'selected' : ''}`}
                    style={{ animationDelay: `${index * 12}ms` }}
                    onClick={() => {
                      if (item.type === 'prefix') {
                        navigate(currentBucket, item.name, true);
                      } else {
                        setSelectedKey(key);
                      }
                    }}
                    onContextMenu={(event) => openItemMenu(event, item)}
                    draggable={item.type === 'file'}
                    onDragStart={(event) => handleDragStart(event, item)}
                    onDrop={
                      item.type === 'prefix'
                        ? (event) => {
                            event.stopPropagation();
                            handleDrop(event, item.name);
                          }
                        : undefined
                    }
                    onDragOver={
                      item.type === 'prefix'
                        ? (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }
                        : undefined
                    }
                  >
                    <div className="col-name">
                      {item.type === 'file' ? (
                        <input
                          className="row-check"
                          type="checkbox"
                          checked={isChecked}
                          onChange={(event) => {
                            event.stopPropagation();
                            setSelectedFiles((prev) => {
                              const next = new Set(prev);
                              if (event.target.checked) next.add(item.name);
                              else next.delete(item.name);
                              return next;
                            });
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                      ) : (
                        <span className="row-check placeholder" />
                      )}
                      <span className={`icon ${item.type}`}>{item.type === 'prefix' ? 'DIR' : 'FILE'}</span>
                      <span className="item-name">{item.displayName}</span>
                    </div>
                    <div className="col-size">{item.type === 'file' ? formatBytes(item.size ?? 0) : '--'}</div>
                    <div className="col-updated">{item.type === 'file' ? formatDate(item.updated) : '--'}</div>
                    <div className="col-actions">
                      {item.type === 'file' ? (
                        <button
                          className="row-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDownload(item);
                          }}
                        >
                          Download
                        </button>
                      ) : (
                        <span className="row-action placeholder" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <footer className="status-bar">
          <div className="status-left">
            {currentBucket ? (
              <span>
                {listing.prefixes.length} folders, {listing.files.length} files
              </span>
            ) : (
              <span>No bucket selected</span>
            )}
          </div>
          <div className="status-right">
            <span>{status || error}</span>
          </div>
        </footer>
      </main>

      {showSearch ? (
        <div className="modal-backdrop" onClick={() => setShowSearch(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Quick Open</div>
                <div className="modal-note">
                  Shows already-loaded folders and files from the current view.
                </div>
              </div>
              <div className="modal-shortcut">Cmd/Ctrl+Opt+O</div>
            </div>
            <input
              ref={searchInputRef}
              className="modal-input"
              placeholder="Type to search paths..."
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
            <div className="modal-list">
              {!currentBucket ? (
                <div className="modal-empty">Select a bucket to search.</div>
              ) : filteredSearchEntries.length === 0 ? (
                <div className="modal-empty">No matches in loaded items.</div>
              ) : (
                filteredSearchEntries.map((entry, index) => (
                  <button
                    key={`${entry.type}:${entry.name}`}
                    className={`modal-item ${index === searchIndex ? 'active' : ''}`}
                    onClick={() => handleSearchSelect(entry)}
                  >
                    <span className="modal-item-title">{entry.label}</span>
                    <span className="modal-item-meta">{entry.detail}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showPathModal ? (
        <div className="modal-backdrop" onClick={() => setShowPathModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Go to Path</div>
                <div className="modal-note">Jump to any gs://bucket/prefix/ you have access to.</div>
              </div>
              <div className="modal-shortcut">Cmd/Ctrl+Shift+P</div>
            </div>
            <form
              className="modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitPath();
              }}
            >
              <input
                ref={pathInputRef}
                className="modal-input"
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                placeholder="gs://bucket/prefix/"
              />
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setShowPathModal(false)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Go
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {contextMenu.items.map((item) => (
            <button
              key={item.label}
              className="context-item"
              onClick={() => {
                setContextMenu(null);
                if (!item.disabled) item.action();
              }}
              disabled={item.disabled}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default App;
