"use server";

import { utpApis, uploads, UtServerNumber, db, UploadPart } from "@/lib";
import { eq } from "drizzle-orm";
import { combineFiles, splitFile } from "@/lib/utils/file";
import { UUID } from "crypto";
import { UploadFileResult } from "uploadthing/types";


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

export async function UploadFiles(files: File[]) {
    try {
        // Process all files in parallel but wait for all to complete
        await Promise.all(files.map(async (file) => {
            try {
                const fileChunks = await splitFile(file, 5);

                // Upload all chunks in parallel
                const uploadResults = await utUploadMultiFile(fileChunks);

                // Process upload results
                const fileChunksDetails: UploadPart[] = uploadResults.map((chunk) => {
                    if (!chunk.data?.key) {
                        throw new Error(`Failed to upload chunk: Missing key for ${chunk.data?.name}`);
                    }
                    return {
                        key: chunk.data.key,
                        name: chunk.data.name,
                        url: chunk.data.ufsUrl,
                    };
                });
                console.log(JSON.stringify(uploadResults))
                // Insert into database
                await db.insert(uploads).values({
                    originalFileName: file.name,
                    mimeType: file.type,
                    originalSize:file.size,
                    uploadParts: fileChunksDetails
                });
            } catch (fileError) {
                console.error(`Error processing file ${file.name}:`, fileError);
                throw fileError; // Re-throw to be caught by the outer try-catch
            }
        }));

        return true;
    } catch (e) {
        console.error("Error in UploadFiles:", e);
        return false;
    }
}

export async function DeleteFile(id: UUID) {
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
export async function GetAllFiles() {
    const files = await db.select().from(uploads);
    return files;
}

export async function GetFile(id: UUID): Promise<{ file: File, name: string }> {
    try {
        const listKey = await db.select().from(uploads).where(eq(uploads.id, id));
        console.log(listKey[0].uploadParts)
        const responses = await Promise.all(
            listKey[0].uploadParts.map(async (part) => {
                const response = await fetch(part.url);
                if (!response.ok) throw new Error(`Failed to fetch part ${part.name}`);
                return {
                    name: part.name,
                    blob: await response.blob()
                };
            })
        );

        // Create File objects from blobs with their original part names
        const chunkFiles = responses.map(response =>
            new File([response.blob], response.name, {
                type: listKey[0].mimeType
            })
        );

        return { file: await combineFiles(chunkFiles, listKey[0].originalFileName), name: listKey[0].originalFileName };
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