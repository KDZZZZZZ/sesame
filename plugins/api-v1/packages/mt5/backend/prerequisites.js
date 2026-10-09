import { join } from 'node:path';
import { ApiError } from './support.js';

export function dependencyRequirement(capability, directory, missing) {
  return { code: 'PREREQUISITE_REQUIRED', capability, missing,
    ...(directory ? { private_directory: join(directory, 'dependencies') } : {}),
    next: { tool: 'mt5_dependencies', action: 'inspect' }, skill: 'skills/dependencies/SKILL.md' };
}
export const dependencyError = (capability, directory, missing) => new ApiError(503, 'PREREQUISITE_REQUIRED', JSON.stringify(dependencyRequirement(capability, directory, missing)));
