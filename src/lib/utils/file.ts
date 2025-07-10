export async function splitFile(file: File, splitSize: number): Promise<File[]> {
    // Validate input
    if (!(file instanceof File)) {
        throw new Error("Input must be a File object");
    }
    if (file.size === 0) {
        throw new Error("Cannot split empty file");
    }
    if (splitSize <= 0) {
        throw new Error("Split size must be greater than 0");
    }

    const chunkSize = Math.ceil(file.size / splitSize);
    const fileChunks: File[] = [];

    for (let i = 0; i < splitSize; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize, file.size);

        // Skip empty chunks (can happen with small files)
        if (start >= end) break;

        const chunkBlob = file.slice(start, end);
        const chunkFile = new File([chunkBlob], `${file.name}.part${i + 1}`, {
            type: file.type,
            lastModified: file.lastModified
        });

        fileChunks.push(chunkFile);
    }

    return fileChunks;
}

export async function combineFiles(chunks: File[], originalName: string): Promise<File> {
    // Validate inputs
    if (!chunks || chunks.length === 0) {
        throw new Error("No chunks provided");
    }
    if (!originalName) {
        throw new Error("Original filename is required");
    }

    // Sort chunks by their part number to ensure correct order
    const sortedChunks = chunks.sort((a, b) => {
        const aPart = parseInt(a.name.split('.part')[1] || '0');
        const bPart = parseInt(b.name.split('.part')[1] || '0');
        return aPart - bPart;
    });

    // Verify all chunks have the same type
    const fileType = sortedChunks[0].type;
    if (!sortedChunks.every(chunk => chunk.type === fileType)) {
        throw new Error("Inconsistent file types among chunks");
    }

    try {
        // Read all chunks as ArrayBuffer (parallel for better performance)
        const chunkBuffers = await Promise.all(
            sortedChunks.map(chunk => chunk.arrayBuffer())
        );

        // Combine all buffers
        const totalLength = chunkBuffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);
        const combinedBuffer = new Uint8Array(totalLength);

        let offset = 0;
        chunkBuffers.forEach(buffer => {
            const uint8Array = new Uint8Array(buffer);
            combinedBuffer.set(uint8Array, offset);
            offset += uint8Array.length;
        });

        // Create final combined file
        return new File([combinedBuffer], originalName, {
            type: fileType,
            lastModified: Date.now()
        });
    } catch (error) {
        throw new Error(`Failed to combine files: ${error instanceof Error ? error.message : String(error)}`);
    }
}