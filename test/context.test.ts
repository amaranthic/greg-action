/**
 * @fileoverview Test suite for GitHub context parsing and typing.
 */

import { describe, expect, it } from "bun:test";
import { isEntityContext } from "../src/github/context.js";
import type {
  EntityGregContext,
  AutomationGregContext,
} from "../src/github/context.js";

describe("isEntityContext", () => {
  it("identifies entity contexts having entityNumber", () => {
    const entityCtx: EntityGregContext = {
      runId: "1",
      eventName: "issue_comment",
      entityNumber: 5,
      isPR: false,
      actor: "user",
      repository: { owner: "o", repo: "r", fullName: "o/r" },
      inputs: {} as any,
      payload: {} as any,
    };
    expect(isEntityContext(entityCtx)).toBe(true);
  });

  it("identifies automation contexts without entityNumber", () => {
    const autoCtx: AutomationGregContext = {
      runId: "2",
      eventName: "schedule",
      actor: "github-actions[bot]",
      repository: { owner: "o", repo: "r", fullName: "o/r" },
      inputs: {} as any,
      payload: {},
    };
    expect(isEntityContext(autoCtx)).toBe(false);
  });
});
