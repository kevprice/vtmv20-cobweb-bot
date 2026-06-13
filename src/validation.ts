import { GuildConfig } from "./types.js";

const MENTION_PATTERN = /<(@!?|@&|#)\d+>|@(everyone|here)/i;

export type ValidationResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export const sanitizeCobwebText = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();

export const containsMention = (text: string): boolean => MENTION_PATTERN.test(text);

export const validateCobwebMessage = (
  text: string,
  config: Pick<GuildConfig, "maxLength" | "blockedTerms">
): ValidationResult => {
  const sanitized = sanitizeCobwebText(text);

  if (sanitized.length === 0) {
    return { ok: false, reason: "The Cobweb refuses empty silence. Add a fragment first." };
  }

  if (sanitized.length > config.maxLength) {
    return {
      ok: false,
      reason: `Fragments must be ${config.maxLength} characters or fewer.`
    };
  }

  if (containsMention(sanitized)) {
    return { ok: false, reason: "Fragments cannot contain Discord mentions." };
  }

  const lowered = sanitized.toLocaleLowerCase();
  const blockedTerm = config.blockedTerms.find((term) =>
    lowered.includes(term.toLocaleLowerCase())
  );

  if (blockedTerm) {
    return {
      ok: false,
      reason: `That fragment contains a configured blocked term: ${blockedTerm}.`
    };
  }

  return { ok: true, text: sanitized };
};

