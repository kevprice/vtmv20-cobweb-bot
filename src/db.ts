import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { GuildConfig, GuildSettings, QueueStatus, QueuedMessage } from "./types.js";
import { isoNow } from "./time.js";

export const DEFAULT_GUILD_SETTINGS = {
  maxLength: 180,
  cooldownMinutes: 15,
  delayWindowMinutes: 60,
  webhookName: "Cobweb"
} as const;

type QueueRow = {
  id: number;
  guild_id: string;
  submitter_id: string;
  submitter_name: string;
  original_text: string;
  current_text: string;
  scheduled_for: string;
  status: QueueStatus;
  moderation_message_id: string | null;
  created_at: string;
  updated_at: string;
  posted_at: string | null;
  failure_reason: string | null;
};

type GuildSettingsRow = {
  guild_id: string;
  cobweb_channel_id: string | null;
  moderation_channel_id: string | null;
  malkavian_role_ids: string;
  st_role_ids: string;
  max_length: number;
  cooldown_minutes: number;
  delay_window_minutes: number;
  webhook_name: string;
  webhook_id: string | null;
  webhook_token: string | null;
  blocked_terms: string;
  created_at: string;
  updated_at: string;
};

export type CreateQueuedMessageInput = {
  guildId: string;
  submitterId: string;
  submitterName: string;
  text: string;
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
          submitter_name,
          original_text,
          current_text,
          scheduled_for,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        input.guildId,
        input.submitterId,
        input.submitterName,
        input.text,
        input.text,
        input.scheduledFor.toISOString(),
        timestamp,
        timestamp
      );

    return this.getQueuedMessage(Number(result.lastInsertRowid))!;
  }

  ensureGuildSettings(guildId: string, now = new Date()): GuildSettings {
    const existing = this.getGuildSettings(guildId);
    if (existing) {
      return existing;
    }

    const timestamp = isoNow(now);
    this.db
      .prepare(
        `INSERT INTO guild_settings (
          guild_id,
          malkavian_role_ids,
          st_role_ids,
          max_length,
          cooldown_minutes,
          delay_window_minutes,
          webhook_name,
          blocked_terms,
          created_at,
          updated_at
        ) VALUES (?, '[]', '[]', ?, ?, ?, ?, '[]', ?, ?)`
      )
      .run(
        guildId,
        DEFAULT_GUILD_SETTINGS.maxLength,
        DEFAULT_GUILD_SETTINGS.cooldownMinutes,
        DEFAULT_GUILD_SETTINGS.delayWindowMinutes,
        DEFAULT_GUILD_SETTINGS.webhookName,
        timestamp,
        timestamp
      );

    return this.getGuildSettings(guildId)!;
  }

  getGuildSettings(guildId: string): GuildSettings | null {
    const row = this.db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId) as
      | GuildSettingsRow
      | undefined;
    return row ? mapGuildSettingsRow(row) : null;
  }

  getRunnableGuildConfig(guildId: string): GuildConfig | null {
    const settings = this.getGuildSettings(guildId);
    if (
      !settings?.cobwebChannelId ||
      !settings.moderationChannelId ||
      settings.malkavianRoleIds.length === 0 ||
      settings.stRoleIds.length === 0
    ) {
      return null;
    }

    return {
      guildId: settings.guildId,
      cobwebChannelId: settings.cobwebChannelId,
      moderationChannelId: settings.moderationChannelId,
      malkavianRoleIds: settings.malkavianRoleIds,
      stRoleIds: settings.stRoleIds,
      maxLength: settings.maxLength,
      cooldownMinutes: settings.cooldownMinutes,
      delayWindowMinutes: settings.delayWindowMinutes,
      webhookName: settings.webhookName,
      webhookId: settings.webhookId,
      webhookToken: settings.webhookToken,
      blockedTerms: settings.blockedTerms
    };
  }

  listRunnableGuildConfigs(): GuildConfig[] {
    const rows = this.db.prepare("SELECT guild_id FROM guild_settings").all() as Array<{
      guild_id: string;
    }>;

    return rows
      .map((row) => this.getRunnableGuildConfig(row.guild_id))
      .filter((config): config is GuildConfig => Boolean(config));
  }

  setGuildChannel(
    guildId: string,
    field: "cobwebChannelId" | "moderationChannelId",
    channelId: string,
    now = new Date()
  ): GuildSettings {
    this.ensureGuildSettings(guildId, now);
    const column = field === "cobwebChannelId" ? "cobweb_channel_id" : "moderation_channel_id";
    this.db
      .prepare(`UPDATE guild_settings SET ${column} = ?, updated_at = ? WHERE guild_id = ?`)
      .run(channelId, isoNow(now), guildId);
    return this.getGuildSettings(guildId)!;
  }

  addGuildRole(
    guildId: string,
    field: "malkavianRoleIds" | "stRoleIds",
    roleId: string,
    now = new Date()
  ): GuildSettings {
    const settings = this.ensureGuildSettings(guildId, now);
    const values = field === "malkavianRoleIds" ? settings.malkavianRoleIds : settings.stRoleIds;
    const nextValues = values.includes(roleId) ? values : [...values, roleId];
    const column = field === "malkavianRoleIds" ? "malkavian_role_ids" : "st_role_ids";
    this.db
      .prepare(`UPDATE guild_settings SET ${column} = ?, updated_at = ? WHERE guild_id = ?`)
      .run(JSON.stringify(nextValues), isoNow(now), guildId);
    return this.getGuildSettings(guildId)!;
  }

  setGuildRoles(
    guildId: string,
    field: "malkavianRoleIds" | "stRoleIds",
    roleIds: string[],
    now = new Date()
  ): GuildSettings {
    this.ensureGuildSettings(guildId, now);
    const column = field === "malkavianRoleIds" ? "malkavian_role_ids" : "st_role_ids";
    const uniqueRoleIds = [...new Set(roleIds)];
    this.db
      .prepare(`UPDATE guild_settings SET ${column} = ?, updated_at = ? WHERE guild_id = ?`)
      .run(JSON.stringify(uniqueRoleIds), isoNow(now), guildId);
    return this.getGuildSettings(guildId)!;
  }

  setGuildNumber(
    guildId: string,
    field: "maxLength" | "cooldownMinutes" | "delayWindowMinutes",
    value: number,
    now = new Date()
  ): GuildSettings {
    this.ensureGuildSettings(guildId, now);
    const column =
      field === "maxLength"
        ? "max_length"
        : field === "cooldownMinutes"
          ? "cooldown_minutes"
          : "delay_window_minutes";
    this.db
      .prepare(`UPDATE guild_settings SET ${column} = ?, updated_at = ? WHERE guild_id = ?`)
      .run(Math.floor(value), isoNow(now), guildId);
    return this.getGuildSettings(guildId)!;
  }

  addBlockedTerm(guildId: string, term: string, now = new Date()): GuildSettings {
    const settings = this.ensureGuildSettings(guildId, now);
    const normalized = term.trim();
    const exists = settings.blockedTerms.some(
      (blocked) => blocked.toLocaleLowerCase() === normalized.toLocaleLowerCase()
    );
    const nextTerms = exists || normalized.length === 0 ? settings.blockedTerms : [...settings.blockedTerms, normalized];
    this.db
      .prepare("UPDATE guild_settings SET blocked_terms = ?, updated_at = ? WHERE guild_id = ?")
      .run(JSON.stringify(nextTerms), isoNow(now), guildId);
    return this.getGuildSettings(guildId)!;
  }

  removeBlockedTerm(guildId: string, term: string, now = new Date()): GuildSettings {
    const settings = this.ensureGuildSettings(guildId, now);
    const lowered = term.trim().toLocaleLowerCase();
    const nextTerms = settings.blockedTerms.filter(
      (blocked) => blocked.toLocaleLowerCase() !== lowered
    );
    this.db
      .prepare("UPDATE guild_settings SET blocked_terms = ?, updated_at = ? WHERE guild_id = ?")
      .run(JSON.stringify(nextTerms), isoNow(now), guildId);
    return this.getGuildSettings(guildId)!;
  }

  setBlockedTerms(guildId: string, terms: string[], now = new Date()): GuildSettings {
    this.ensureGuildSettings(guildId, now);
    const uniqueTerms = terms.reduce<string[]>((result, term) => {
      const normalized = term.trim();
      if (
        normalized &&
        !result.some((existing) => existing.toLocaleLowerCase() === normalized.toLocaleLowerCase())
      ) {
        result.push(normalized);
      }
      return result;
    }, []);
    this.db
      .prepare("UPDATE guild_settings SET blocked_terms = ?, updated_at = ? WHERE guild_id = ?")
      .run(JSON.stringify(uniqueTerms), isoNow(now), guildId);
    return this.getGuildSettings(guildId)!;
  }

  setGuildWebhook(
    guildId: string,
    webhookId: string | null,
    webhookToken: string | null,
    now = new Date()
  ): GuildSettings {
    this.ensureGuildSettings(guildId, now);
    this.db
      .prepare(
        `UPDATE guild_settings
         SET webhook_id = ?, webhook_token = ?, updated_at = ?
         WHERE guild_id = ?`
      )
      .run(webhookId, webhookToken, isoNow(now), guildId);
    return this.getGuildSettings(guildId)!;
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
        submitter_name TEXT NOT NULL DEFAULT 'Unknown',
        original_text TEXT NOT NULL,
        current_text TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        cobweb_channel_id TEXT,
        moderation_channel_id TEXT,
        malkavian_role_ids TEXT NOT NULL DEFAULT '[]',
        st_role_ids TEXT NOT NULL DEFAULT '[]',
        max_length INTEGER NOT NULL DEFAULT 180,
        cooldown_minutes INTEGER NOT NULL DEFAULT 15,
        delay_window_minutes INTEGER NOT NULL DEFAULT 60,
        webhook_name TEXT NOT NULL DEFAULT 'Cobweb',
        webhook_id TEXT,
        webhook_token TEXT,
        blocked_terms TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.addColumnIfMissing("queued_messages", "submitter_name", "TEXT NOT NULL DEFAULT 'Unknown'");
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!rows.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

const mapRow = (row: QueueRow): QueuedMessage => ({
  id: row.id,
  guildId: row.guild_id,
  submitterId: row.submitter_id,
  submitterName: row.submitter_name,
  originalText: row.original_text,
  currentText: row.current_text,
  scheduledFor: row.scheduled_for,
  status: row.status,
  moderationMessageId: row.moderation_message_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  postedAt: row.posted_at,
  failureReason: row.failure_reason
});

const parseStringArray = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
};

const mapGuildSettingsRow = (row: GuildSettingsRow): GuildSettings => ({
  guildId: row.guild_id,
  cobwebChannelId: row.cobweb_channel_id,
  moderationChannelId: row.moderation_channel_id,
  malkavianRoleIds: parseStringArray(row.malkavian_role_ids),
  stRoleIds: parseStringArray(row.st_role_ids),
  maxLength: row.max_length,
  cooldownMinutes: row.cooldown_minutes,
  delayWindowMinutes: row.delay_window_minutes,
  webhookName: row.webhook_name,
  webhookId: row.webhook_id,
  webhookToken: row.webhook_token,
  blockedTerms: parseStringArray(row.blocked_terms),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
