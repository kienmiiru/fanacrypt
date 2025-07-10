import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { UploadPart } from '../types';
import { randomUUID } from 'crypto';

const db = drizzle(process.env.DB_FILE_NAME!);

const uploads = sqliteTable('uploads', {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    originalFileName: text('original_file_name').notNull(),
    originalSize: integer('original_size').notNull(),
    mimeType: text('mime_type').notNull(),
    uploadParts: text('upload_parts', { mode: 'json' }).$type<UploadPart[]>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export { db, uploads };
