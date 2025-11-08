"use server";

import { utpApis, uploads, UtServerNumber, db, UploadPart } from "@/lib";
import { eq } from "drizzle-orm";
// import { combineFiles, splitFile } from "@/lib/utils/file";
import { createHash } from "crypto";
import { UUID } from "crypto";
import { UploadFileResult } from "uploadthing/types";
import { verifySession } from "./auth-actions";


async function utUploadFiles(files: File[], server: UtServerNumber) {
    if (files.length === 0) {
        throw new Error("No files selected for upload");
    }
    const response = await utpApis[server].uploadFiles(files);
    if (!response) {
        throw new Error("Failed to upload files");
    }
    return response;
}

async function utUploadMultiFile(files: File[]) {
    const details: UploadFileResult[] = []
    const results = await Promise.all(
        files.map(async (file, i) => {
            const result = await utUploadFiles([file], i as UtServerNumber)
            return { index: i, result }
        })
    )

    results
        .sort((a, b) => a.index - b.index)
        .forEach(async ({ result }) => {
            details.push(...result)
        })

    return details;
}

// Helper function to verify session
async function requireAuth(sessionToken: string | null | undefined): Promise<void> {
  if (!sessionToken) {
    throw new Error("Authentication required");
  }
  const isValid = await verifySession(sessionToken);
  if (!isValid) {
    throw new Error("Invalid or expired session");
  }
}

// Accepts encrypted chunks as FormData and uploads them to UploadThing servers after integrity checks
export async function UploadEncrypted(formData: FormData, sessionToken?: string | null): Promise<{ id: string }>{
    await requireAuth(sessionToken);
    const metaRaw = formData.get("meta");
    const fileHash = formData.get("file_hash");
    const chunkHashesRaw = formData.get("chunk_hashes");

    if (!metaRaw || !fileHash || !chunkHashesRaw) {
        throw new Error("Missing required fields: meta, file_hash, chunk_hashes");
    }

    const meta = JSON.parse(String(metaRaw)) as { filename: string; size: number; mime: string };
    const chunkHashes = JSON.parse(String(chunkHashesRaw)) as string[]; // base64 strings

    // Collect File entries from FormData in deterministic order by part index encoded in name
    const chunkEntries: { index: number; file: File }[] = [];
    for (const [key, value] of (formData as any).entries()) {
        if (value instanceof File && key.startsWith("chunk")) {
            const idx = parseInt(key.replace("chunk", ""));
            chunkEntries.push({ index: idx, file: value });
        }
    }
    chunkEntries.sort((a, b) => a.index - b.index);

    if (chunkEntries.length !== chunkHashes.length) {
        throw new Error("Chunk count does not match hash count");
    }

    // Verify each chunk hash H(IV||C)
    await Promise.all(chunkEntries.map(async ({ file }, i) => {
        const buf = Buffer.from(await file.arrayBuffer());
        const h = createHash("sha256").update(buf).digest("base64");
        if (h !== chunkHashes[i]) {
            throw new Error(`Chunk ${i} hash mismatch`);
        }
    }));

    // Upload in parallel to each UploadThing server
    const filesToUpload = chunkEntries.map(({ file }) => file);
    const uploadResults = await utUploadMultiFile(filesToUpload);

    const fileChunksDetails: UploadPart[] = uploadResults.map((chunk, i) => {
        if (!chunk.data?.key) {
            throw new Error(`Failed to upload chunk: Missing key for ${chunk.data?.name}`);
        }
        return {
            key: chunk.data.key,
            name: chunk.data.name,
            url: chunk.data.ufsUrl,
            hash: chunkHashes[i],
        } as UploadPart;
    });

    // Verify overall file_hash = H(h0||h1||...)
    const combinedHashesBuffer = Buffer.from(chunkHashes.join(""));
    const combinedHash = createHash("sha256").update(combinedHashesBuffer).digest("base64");
    if (combinedHash !== fileHash) {
        throw new Error("file_hash mismatch");
    }

    const inserted = await db.insert(uploads).values({
        originalFileName: meta.filename,
        mimeType: meta.mime,
        originalSize: meta.size,
        uploadParts: fileChunksDetails,
        fileHash: String(fileHash),
    }).returning({ id: uploads.id });

    return { id: inserted[0].id };
}

export async function DeleteFile(id: UUID, sessionToken?: string | null) {
    await requireAuth(sessionToken);
    try {
        const listKey = await db.select().from(uploads).where(eq(uploads.id, id));
        await Promise.all(listKey[0].uploadParts.map(async (key, i) => {
            utDeleteFile(key.key, i as UtServerNumber);
        })).then(async () => {
            await db.delete(uploads).where(eq(uploads.id, listKey[0].id))
        })
        return true
    } catch (e) {
        console.log(e)
        return false
    }
}
export async function GetAllFiles(sessionToken?: string | null) {
    await requireAuth(sessionToken);
    const files = await db.select().from(uploads);
    return files;
}

export async function GetFile(id: UUID, sessionToken?: string | null): Promise<{
    originalFileName: string;
    mimeType: string;
    originalSize: number;
    fileHash: string;
    uploadParts: UploadPart[];
}> {
    try {
        const rows = await db.select().from(uploads).where(eq(uploads.id, id));
        const rec = rows[0];
        return {
            originalFileName: rec.originalFileName,
            mimeType: rec.mimeType,
            originalSize: rec.originalSize,
            fileHash: rec.fileHash,
            uploadParts: rec.uploadParts,
        };
    } catch (error) {
        console.error("Error in GetFile:", error);
        throw error;
    }
}

async function utDeleteFile(fileId: string | string[], server: UtServerNumber) {
    if (!fileId) {
        throw new Error("File ID is required");
    }
    const response = await utpApis[server].deleteFiles(fileId, { keyType: "fileKey" });
    if (!response) {
        throw new Error("Failed to delete file");
    }
    return response;
}

// async function listFiles(server: UtServerNumber) {
//     const response = await utpApis[server].listFiles();
//     if (!response) {
//         throw new Error("Failed to list files");
//     }
//     return response;
// }