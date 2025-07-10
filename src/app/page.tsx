"use client";

import { useState, useRef, useEffect } from 'react';
import { UploadFiles, GetAllFiles, DeleteFile, GetFile } from './actions';
import { UploadPart } from '@/lib';
import { UUID } from 'crypto';

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

  useEffect(() => {
    loadFiles();
  }, []);

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

    try {
      // Simulate progress (replace with actual progress events if available)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          const newProgress = prev + Math.random() * 10;
          return newProgress >= 100 ? 100 : newProgress;
        });
      }, 300);

      const success = await UploadFiles([selectedFile]);
      clearInterval(progressInterval);

      if (success) {
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

  const handleDownload = async (id: string) => {
    setIsDownloading(id);
    try {
      const fileData = await GetFile(id as UUID);
      const url = URL.createObjectURL(fileData.file);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileData.name;
      document.body.appendChild(a);
      a.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error('Download failed:', error);
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
                      Uploading... ({Math.round(uploadProgress)}%)
                    </>
                  ) : (
                    '🚀 Upload'
                  )}
                </button>

                {isUploading && (
                  <div className="w-full bg-gray-700 rounded-full h-2.5">
                    <div
                      className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                )}
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
                              Downloading...
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