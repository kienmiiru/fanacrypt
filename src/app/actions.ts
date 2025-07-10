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
            const result = utUploadFiles([file], i as UtServerNumber)
            return { index: i, result }
        })
    )

    results
        .sort((a, b) => a.index - b.index)
        .forEach(async ({ result }) => {
            details.push(...await result)
        })

    return details;
}

export async function UploadFiles(files: File[]) {
    try {
        files.forEach(async (file) => {
            const fileChunks = await splitFile(file, 5)
            const fileChunksDetails: UploadPart[] = (await utUploadMultiFile(fileChunks)).map((chunk) => {
                if (chunk.data?.key) {
                    return {
                        key: chunk.data.key,
                        name: chunk.data.name,
                        url: chunk.data.ufsUrl,
                    }
                } else {
                    throw new Error("Failed to Parse Chunks details")
                }
            })
            await db.insert(uploads).values({
                originalFileName: file.name,
                mimeType: file.type,
                uploadParts: fileChunksDetails
            })
        })
        return true
    } catch (e) {
        console.log(e)
        return false
    }
}
export async function DeleteFile(id: UUID) {
    try {
        const listKey = await db.select().from(uploads).where(eq(uploads.id, id));
        await Promise.all(listKey.map(async (key, i) => {
            utDeleteFile(key.id, i as UtServerNumber);
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

export async function GetFile(id: UUID): Promise<File> {
    const listKey = await db.select().from(uploads).where(eq(uploads.id, id));
    const responses = await Promise.all(listKey[0].uploadParts.map(async (e, i) => {
        return { index: i, response: fetch(e.url) }
    }))
    const blobs = await Promise.all(responses.sort((a, b) => a.index - b.index).map(async e => await (await e.response).blob()))
    return await combineFiles(blobs.map(e => new File([e], listKey[0].originalFileName)), listKey[0].originalFileName)
}

async function utDeleteFile(fileId: string | string[], server: UtServerNumber) {
    if (!fileId) {
        throw new Error("File ID is required");
    }
    const response = await utpApis[server].deleteFiles(fileId);
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