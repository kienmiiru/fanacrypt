"use client";

import { useState, useRef, useEffect } from 'react';
import { UploadEncrypted, GetAllFiles, DeleteFile, GetFile } from './actions';
import { UploadPart } from '@/lib';
import { UUID } from 'crypto';
import { aesGcmDecrypt, aesGcmEncrypt, concatBytes, fromBase64, generateAesGcmKey, randomIv, sha256, toBase64 } from '@/lib/utils/crypto';

export default function FileUploadUI() {
  const [files, setFiles] = useState<{
    id: string;
    originalFileName: string;
    mimeType: string;
    originalSize: number;
    uploadParts: UploadPart[];
    createdAt: Date | null;
  }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [phaseMessage, setPhaseMessage] = useState<string>('');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareKey, setShareKey] = useState<string | null>(null);

  useEffect(() => {
    loadFiles();
    // Auto download if URL contains #/id:key
    tryAutoDownloadFromHash();
  }, []);

  const tryAutoDownloadFromHash = async () => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash; // format: #/id:key
    if (!hash || !hash.startsWith('#/')) return;
    const payload = hash.slice(2);
    if (!payload.includes(':')) return;
    const [id, key] = payload.split(':');
    if (id && key) {
      await handleDownload(id, key);
    }
  };

  const loadFiles = async () => {
    setIsLoadingFiles(true);
    try {
      const loadedFiles = await GetAllFiles();
      setFiles(loadedFiles);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(0);
    setPhaseMessage('Preparing upload...');

    try {
      // Simulate progress (replace with actual progress events if available)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          const newProgress = prev + Math.random() * 10;
          return newProgress >= 98 ? 98 : newProgress;
        });
      }, 300);

      // Client-side split, encrypt, hash
      // For simplicity, reuse existing splitter to get 5 equal chunks
      setPhaseMessage('Splitting file...');
      const chunks = await (async () => {
        // Implement simple equal slicing without creating Files twice
        const buf = new Uint8Array(await selectedFile.arrayBuffer());
        const n = 5;
        const size = Math.ceil(buf.byteLength / n);
        const parts: Uint8Array[] = [];
        for (let i = 0; i < n; i++) {
          const start = i * size;
          const end = Math.min(start + size, buf.byteLength);
          if (start >= end) break;
          parts.push(buf.subarray(start, end));
        }
        return parts;
      })();

      setPhaseMessage('Generating key...');
      const { key, base64Key } = await generateAesGcmKey();

      const encryptedBlobs: Blob[] = [];
      const chunkHashes: string[] = [];

      setPhaseMessage('Encrypting chunks...');
      for (let i = 0; i < chunks.length; i++) {
        const iv = randomIv(12);
        const ct = await aesGcmEncrypt(key, iv, chunks[i]);
        const bi = concatBytes([iv, ct]);
        const h = await sha256(bi);
        chunkHashes.push(toBase64(h));
        const arrBuf = bi.buffer.slice(bi.byteOffset, bi.byteOffset + bi.byteLength);
        encryptedBlobs.push(new Blob([arrBuf as unknown as BlobPart]));
      }

      // file_hash = H(h0||h1||...)
      setPhaseMessage('Computing file hash...');
      const combinedHashInput = new TextEncoder().encode(chunkHashes.join(""));
      const fileHashBytes = await sha256(combinedHashInput);
      const fileHash = toBase64(fileHashBytes);

      setPhaseMessage('Uploading encrypted chunks...');
      const form = new FormData();
      form.append('meta', JSON.stringify({ filename: selectedFile.name, size: selectedFile.size, mime: selectedFile.type }));
      form.append('file_hash', fileHash);
      form.append('chunk_hashes', JSON.stringify(chunkHashes));
      encryptedBlobs.forEach((blob, i) => form.append(`chunk${i}`, new File([blob], `${selectedFile.name}.part${i}`)));

      const { id } = await UploadEncrypted(form);
      clearInterval(progressInterval);

      // Show shareable link with key in fragment
      const link = `${window.location.origin}/#/` + id + ':' + base64Key;
      setShareLink(link);
      setShareKey(base64Key);
      setPhaseMessage('Upload complete. Link and key are available below.');

      if (id) {
        setUploadProgress(100);
        await new Promise(resolve => setTimeout(resolve, 500)); // Show completion briefly
        await loadFiles();
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
      setPhaseMessage('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('🗑️ Are you sure you want to delete this file?')) return;

    setIsDeleting(id);
    try {
      const success = await DeleteFile(id as UUID);
      if (success) {
        await loadFiles();
      }
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleDownload = async (id: string, keyFromFragment?: string) => {
    setIsDownloading(id);
    try {
      setPhaseMessage('Fetching metadata...');
      const meta = await GetFile(id as UUID);
      // Ask user for key (base64) or parse from URL fragment if present
      let keyB64 = keyFromFragment || window.location.hash.split('/').pop()?.split(':')[1];
      if (!keyB64) keyB64 = window.prompt('Enter decryption key (base64):') || '';
      if (!keyB64) throw new Error('Missing decryption key');

      setPhaseMessage('Preparing decryption key...');
      const rawKey = fromBase64(keyB64);
      const rawKeyBuf = rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength);
      const cryptoKey = await crypto.subtle.importKey('raw', rawKeyBuf as unknown as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);

      // Download each encrypted chunk (IV||C), verify hash, decrypt
      const parts = meta.uploadParts;
      const plaintextChunks: Uint8Array[] = [];
      setPhaseMessage('Downloading and verifying chunks...');
      await Promise.all(parts.map(async (p, i) => {
        const res = await fetch(p.url);
        if (!res.ok) throw new Error('Failed to fetch chunk ' + i);
        const buf = new Uint8Array(await res.arrayBuffer());
        const h = await sha256(buf);
        const hB64 = toBase64(h);
        if (hB64 !== p.hash) throw new Error(`Hash mismatch on chunk ${i}`);
        const iv = buf.subarray(0, 12);
        const ct = buf.subarray(12);
        setPhaseMessage(`Decrypting chunk ${i + 1}/${parts.length}...`);
        const pt = await aesGcmDecrypt(cryptoKey as CryptoKey, iv, ct);
        plaintextChunks[i] = pt;
      }));

      setPhaseMessage('Merging chunks...');
      const combined = concatBytes(plaintextChunks);
      const combinedBuf = combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);
      const file = new File([combinedBuf as unknown as BlobPart], meta.originalFileName, { type: meta.mimeType });
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.originalFileName;
      document.body.appendChild(a);
      a.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      setPhaseMessage('Download complete.');
    } catch (error) {
      console.error('Download failed:', error);
      setPhaseMessage('Download failed. Please check the link and key.');
    } finally {
      setIsDownloading(null);
    }
  };

  const getFileEmoji = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return '🗜️';
    if (mimeType.includes('word')) return '📝';
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
    return '📁';
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'Unknown';
    return new Date(date).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-neutral-950 p-6 w-screen">
      <div className="mx-auto container">
        <h1 className="text-3xl font-bold text-gray-100 mb-6">📁 upload<span className='text-red-600'>thing</span> Distributed File Upload</h1>

        {/* Upload Section */}
        <div className="bg-neutral-950 rounded-lg shadow-lg p-6 mb-8 border border-gray-700">
          <h2 className="text-xl font-semibold text-gray-200 mb-4">⬆️ Upload Files</h2>

          <div className="flex flex-col space-y-4">
            <div className="flex items-center space-x-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
                disabled={isUploading}
              />
              <label
                htmlFor="file-upload"
                className={`px-4 py-2 border border-gray-700 rounded-md cursor-pointer transition ${isUploading
                  ? 'bg-neutral-800 text-gray-500 cursor-not-allowed'
                  : 'bg-neutral-800 text-white hover:bg-neutral-900'
                  }`}
              >
                📂 Choose File
              </label>
              <span className="text-gray-400 truncate max-w-xs">
                {selectedFile ? selectedFile.name : 'No file selected'}
              </span>
            </div>

            {selectedFile && (
              <div className="flex flex-col space-y-2">
                <button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className={`px-4 py-2 rounded-md flex items-center justify-center ${isUploading
                    ? 'bg-red-700 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700'
                    } text-white transition`}
                >
                  {isUploading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {phaseMessage || 'Uploading...'} ({Math.round(uploadProgress)}%)
                    </>
                  ) : (
                    '🚀 Upload'
                  )}
                </button>

                {isUploading && (
                  <div className="w-full bg-gray-700 rounded-full h-1">
                    <div
                      className="bg-white h-1 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                )}
              </div>
            )}
            {shareLink && (
              <div className="mt-4 p-3 rounded border border-gray-700 bg-neutral-900 text-gray-200 space-y-2">
                <div className="text-sm">Shareable Link</div>
                <div className="flex items-center gap-2">
                  <input className="w-full bg-neutral-800 text-gray-100 px-2 py-1 rounded" value={shareLink} readOnly />
                  <button className="px-2 py-1 bg-neutral-800 rounded text-gray-200" onClick={() => navigator.clipboard.writeText(shareLink!)}>Copy</button>
                </div>
                <div className="text-sm mt-2">Base64 Key</div>
                <div className="flex items-center gap-2">
                  <input className="w-full bg-neutral-800 text-gray-100 px-2 py-1 rounded" value={shareKey || ''} readOnly />
                  <button className="px-2 py-1 bg-neutral-800 rounded text-gray-200" onClick={() => navigator.clipboard.writeText(shareKey || '')}>Copy</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Files List */}
        <div className="bg-neutral-950 rounded-lg shadow-lg p-6 border border-gray-700">
          <h2 className="text-xl font-semibold text-gray-200 mb-4">🗂️ Your Files</h2>

          {isLoadingFiles ? (
            <div className="flex justify-center py-8">
              <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              📭 No files uploaded yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-750">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">File</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Uploaded</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {files.map((file) => (
                    <tr key={file.id} className="hover:bg-gray-750 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className="text-xl mr-3">{getFileEmoji(file.mimeType)}</span>
                          <div className="text-sm font-medium text-gray-100 truncate max-w-xs">
                            {file.originalFileName}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {file.mimeType}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {file.originalSize < 1024
                          ? `${file.originalSize} B`
                          : file.originalSize < 1024 * 1024
                            ? `${(file.originalSize / 1024).toFixed(2)} KB`
                            : file.originalSize < 1024 * 1024 * 1024
                              ? `${(file.originalSize / (1024 * 1024)).toFixed(2)} MB`
                              : `${(file.originalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {formatDate(file.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => handleDownload(file.id)}
                          disabled={isDownloading === file.id}
                          className={`text-blue-400 hover:text-blue-300 mr-4 ${isDownloading === file.id ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                        >
                          {isDownloading === file.id ? (
                            <span className="flex items-center">
                              <svg className="animate-spin -ml-1 mr-1 h-4 w-4 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              {phaseMessage || 'Downloading...'}
                            </span>
                          ) : (
                            '⬇️ Download'
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(file.id)}
                          disabled={isDeleting === file.id}
                          className={`text-red-400 hover:text-red-300 ${isDeleting === file.id ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                        >
                          {isDeleting === file.id ? (
                            <span className="flex items-center">
                              <svg className="animate-spin -ml-1 mr-1 h-4 w-4 text-red-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Deleting...
                            </span>
                          ) : (
                            '🗑️ Delete'
                          )}
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
}