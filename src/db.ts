import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { CobwebCategory, QueueStatus, QueuedMessage } from "./types.js";
import { isoNow } from "./time.js";

type QueueRow = {
  id: number;
  guild_id: string;
  submitter_id: string;
  original_text: string;
  current_text: string;
  category: CobwebCategory | null;
  scheduled_for: string;
  status: QueueStatus;
  moderation_message_id: string | null;
  created_at: string;
  updated_at: string;
  posted_at: string | null;
  failure_reason: string | null;
};

export type CreateQueuedMessageInput = {
  guildId: string;
  submitterId: string;
  text: string;
  category?: CobwebCategory | null;
  scheduledFor: Date;
};

export class CobwebStore {
  private readonly db: Database.Database;

  constructor(path = ":memory:") {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createQueuedMessage(input: CreateQueuedMessageInput, now = new Date()): QueuedMessage {
    const timestamp = isoNow(now);
    const result = this.db
      .prepare(
        `INSERT INTO queued_messages (
          guild_id,
          submitter_id,
          original_text,
          current_text,
          category,
          scheduled_for,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        input.guildId,
        input.submitterId,
        input.text,
        input.text,
        input.category ?? null,
        input.scheduledFor.toISOString(),
        timestamp,
        timestamp
      );

    return this.getQueuedMessage(Number(result.lastInsertRowid))!;
  }

  getQueuedMessage(id: number): QueuedMessage | null {
    const row = this.db.prepare("SELECT * FROM queued_messages WHERE id = ?").get(id) as
      | QueueRow
      | undefined;
    return row ? mapRow(row) : null;
  }

  getLastAcceptedSubmission(
    guildId: string,
    submitterId: string,
    now = new Date()
  ): QueuedMessage | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM queued_messages
         WHERE guild_id = ?
           AND submitter_id = ?
           AND status IN ('pending', 'posted', 'failed')
           AND created_at <= ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(guildId, submitterId, now.toISOString()) as QueueRow | undefined;

    return row ? mapRow(row) : null;
  }

  setModerationMessageId(id: number, moderationMessageId: string, now = new Date()): void {
    this.db
      .prepare(
        `UPDATE queued_messages
         SET moderation_message_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(moderationMessageId, isoNow(now), id);
  }

  editQueuedMessage(id: number, text: string, now = new Date()): QueuedMessage | null {
    this.db
      .prepare(
        `UPDATE queued_messages
         SET current_text = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(text, isoNow(now), id);

    return this.getQueuedMessage(id);
  }

  deleteQueuedMessage(id: number, now = new Date()): QueuedMessage | null {
    this.db
      .prepare(
        `UPDATE queued_messages
         SET status = 'deleted', updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(isoNow(now), id);

    return this.getQueuedMessage(id);
  }

  markPosted(id: number, now = new Date()): QueuedMessage | null {
    const timestamp = isoNow(now);
    this.db
      .prepare(
        `UPDATE queued_messages
         SET status = 'posted', posted_at = ?, updated_at = ?, failure_reason = NULL
         WHERE id = ? AND status IN ('pending', 'failed')`
      )
      .run(timestamp, timestamp, id);

    return this.getQueuedMessage(id);
  }

  markFailed(id: number, reason: string, now = new Date()): QueuedMessage | null {
    this.db
      .prepare(
        `UPDATE queued_messages
         SET status = 'failed', failure_reason = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'failed')`
      )
      .run(reason.slice(0, 1000), isoNow(now), id);

    return this.getQueuedMessage(id);
  }

  listDueMessages(now = new Date(), limit = 25): QueuedMessage[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM queued_messages
         WHERE status IN ('pending', 'failed')
           AND scheduled_for <= ?
         ORDER BY scheduled_for ASC, id ASC
         LIMIT ?`
      )
      .all(now.toISOString(), limit) as QueueRow[];

    return rows.map(mapRow);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queued_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        submitter_id TEXT NOT NULL,
        original_text TEXT NOT NULL,
        current_text TEXT NOT NULL,
        category TEXT,
        scheduled_for TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'deleted', 'posted', 'failed')),
        moderation_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        posted_at TEXT,
        failure_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_queued_messages_due
        ON queued_messages(status, scheduled_for);

      CREATE INDEX IF NOT EXISTS idx_queued_messages_cooldown
        ON queued_messages(guild_id, submitter_id, created_at);
    `);
  }
}

const mapRow = (row: QueueRow): QueuedMessage => ({
  id: row.id,
  guildId: row.guild_id,
  submitterId: row.submitter_id,
  originalText: row.original_text,
  currentText: row.current_text,
  category: row.category,
  scheduledFor: row.scheduled_for,
  status: row.status,
  moderationMessageId: row.moderation_message_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  postedAt: row.posted_at,
  failureReason: row.failure_reason
});

