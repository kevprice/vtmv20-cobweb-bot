import { GuildConfig } from "./types.js";

export type RoleCarrier = {
  roles: {
    cache: {
      has(roleId: string): boolean;
    };
  };
};

const hasAnyRole = (member: RoleCarrier, roleIds: string[]): boolean =>
  roleIds.some((roleId) => member.roles.cache.has(roleId));

export const isStoryteller = (member: RoleCarrier, config: GuildConfig): boolean =>
  hasAnyRole(member, config.stRoleIds);

export const canUseCobweb = (member: RoleCarrier, config: GuildConfig): boolean =>
  isStoryteller(member, config) || hasAnyRole(member, config.malkavianRoleIds);

