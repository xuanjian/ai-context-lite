export { REPOSITORY_METHODS } from "../contracts/devflow-types.mjs";

import { REPOSITORY_METHODS } from "../contracts/devflow-types.mjs";

export function assertRepositoryContract(repository) {
  const missingMethods = REPOSITORY_METHODS.filter((methodName) => typeof repository?.[methodName] !== "function");

  if (missingMethods.length > 0) {
    throw new TypeError(`Repository is missing required methods: ${missingMethods.join(", ")}`);
  }

  return repository;
}
