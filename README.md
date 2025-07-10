# UploadThing RAID - Distributed File Upload System

A proof-of-concept implementation showcasing distributed file uploads using UploadThing's API with file splitting and parallel uploads.

![File Upload UI Preview](https://i.imgur.com/JQZ1l1a.png)

## ✨ Features

- **Parallel Chunk Uploads**: Files are split into chunks and uploaded simultaneously to different UploadThing servers
- **Progress Tracking**: Visual upload progress indicator
- **File Management**: List, download, and delete uploaded files
- **Type Safety**: Fully typed with TypeScript
- **Responsive UI**: Clean, modern interface with emoji flair
- **Database Integration**: SQLite storage for file metadata

## 🛠️ Tech Stack

- **Frontend**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Database**: SQLite (via Drizzle ORM)
- **File Storage**: UploadThing (multi-server)
- **UI**: React hooks, modern components
- **Build**: TypeScript, ES Modules

## 📦 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/MasFana/fanathing.git
   cd fanathing
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in your UploadThing API keys and database configuration.

4. Run the development server:
   ```bash
   npm run dev
   ```

## 🧠 How It Works

### File Upload Flow
1. User selects a file
2. File is split into 5 chunks (configurable)
3. Each chunk is uploaded to a different UploadThing server in parallel
4. Upload metadata is stored in SQLite
5. UI shows real-time progress

### File Download Flow
1. User requests a file download
2. System fetches all chunks from their respective URLs
3. Chunks are combined in the correct order
4. Original file is reconstructed and downloaded

## 📂 Project Structure

```
src/
├── app/                 # Next.js app router
│   ├── actions.ts       # Server actions for file operations
│   ├── page.tsx         # Main UI component
│   └── layout.tsx       # Root layout
└── lib/
    ├── db/              # Database schema and connection
    ├── utils/           # Utility functions
    └── types.ts         # Type definitions
```

## 🌟 Why?

This project demonstrates:
- Handling large file uploads efficiently
- Distributed upload architecture
- Client-side file reassembly
- Robust error handling
- Modern React patterns

## 🚧 Future Improvements

- [ ] Add Handler to Delete file if theere is Error on one Node
- [ ] Real upload progress (currently simulated)
- [ ] Resumable uploads
- [ ] File previews
- [ ] User authentication
- [ ] Chunk size optimization

Made with ❤️ by [Fana] | [GitHub](https://github.com/MasFana)
