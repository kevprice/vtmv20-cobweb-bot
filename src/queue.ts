import { CobwebStore } from "./db.js";
import { GuildConfig, QueuedMessage, SubmissionInput } from "./types.js";
import { addMinutes, randomScheduledDate } from "./time.js";
import { validateCobwebMessage } from "./validation.js";

export type SubmissionResult =
  | { ok: true; queued: QueuedMessage }
  | { ok: false; reason: string };

export const submitCobwebMessage = (
  store: CobwebStore,
  config: GuildConfig,
  input: SubmissionInput,
  now = new Date(),
  random: () => number = Math.random
): SubmissionResult => {
  const validation = validateCobwebMessage(input.message, config);
  if (!validation.ok) {
    return validation;
  }

  const last = store.getLastAcceptedSubmission(input.guildId, input.submitterId, now);
  if (last) {
    const nextAllowed = addMinutes(new Date(last.createdAt), config.cooldownMinutes);
    if (nextAllowed > now) {
      return {
        ok: false,
        reason: `The Cobweb will listen again around ${formatDiscordTimestamp(nextAllowed)}.`
      };
    }
  }

  const scheduledFor = randomScheduledDate(now, config.delayWindowMinutes, random);
  const queued = store.createQueuedMessage(
    {
      guildId: input.guildId,
      submitterId: input.submitterId,
      text: validation.text,
      category: input.category ?? null,
      scheduledFor
    },
    now
  );

  return { ok: true, queued };
};

export const formatDiscordTimestamp = (date: Date, style: "R" | "f" = "R"): string =>
  `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

