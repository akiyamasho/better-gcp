import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateFolderRequest,
  DeleteRequest,
  DownloadManyRequest,
  DownloadRequest,
  ListObjectsRequest,
  StartDragRequest,
  UploadRequest,
} from './types';

contextBridge.exposeInMainWorld('gcs', {
  listBuckets: () => ipcRenderer.invoke('gcs:list-buckets'),
  listObjects: (req: ListObjectsRequest) => ipcRenderer.invoke('gcs:list-objects', req),
  download: (req: DownloadRequest) => ipcRenderer.invoke('gcs:download', req),
  downloadMany: (req: DownloadManyRequest) => ipcRenderer.invoke('gcs:download-many', req),
  upload: (req: UploadRequest) => ipcRenderer.invoke('gcs:upload', req),
  delete: (req: DeleteRequest) => ipcRenderer.invoke('gcs:delete', req),
  createFolder: (req: CreateFolderRequest) => ipcRenderer.invoke('gcs:create-folder', req),
  startDrag: (req: StartDragRequest) => ipcRenderer.invoke('gcs:start-drag', req),
  chooseUpload: () => ipcRenderer.invoke('gcs:choose-upload'),
});
