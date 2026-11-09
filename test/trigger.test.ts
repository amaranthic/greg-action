/**
 * @fileoverview Test suite for trigger phrase detection.
 */

import { describe, expect, it } from "bun:test";
import {
  containsTriggerPhrase,
  checkContainsTrigger,
} from "../src/github/validation/trigger.js";
import type { GregContext } from "../src/github/context.js";

describe("containsTriggerPhrase", () => {
  it("matches trigger phrase surrounded by whitespace or punctuation", () => {
    expect(containsTriggerPhrase("Hey @greg, can you fix this?", "@greg")).toBe(
      true
    );
    expect(containsTriggerPhrase("@greg please help", "@greg")).toBe(true);
    expect(containsTriggerPhrase("What do you think @greg?", "@greg")).toBe(
      true
    );
    expect(containsTriggerPhrase("cc: @greg.", "@greg")).toBe(true);
  });

  it("does not match partial usernames", () => {
    expect(
      containsTriggerPhrase("Hey @gregory can you fix this?", "@greg")
    ).toBe(false);
    expect(containsTriggerPhrase("email@gregory.com", "@greg")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(containsTriggerPhrase("Hey @GREG take a look", "@greg")).toBe(true);
    expect(containsTriggerPhrase("Hey @Greg take a look", "@GREG")).toBe(true);
  });
});

describe("checkContainsTrigger", () => {
  it("returns true when explicit prompt is provided", () => {
    const context: any = {
      inputs: { prompt: "Analyze failure logs" },
    };
    expect(checkContainsTrigger(context)).toBe(true);
  });

  it("returns true for matching issue comments", () => {
    const context: any = {
      eventName: "issue_comment",
      entityNumber: 10,
      inputs: { triggerPhrase: "@greg", prompt: "" },
      payload: {
        comment: { body: "Hey @greg check this out" },
      },
    };
    expect(checkContainsTrigger(context)).toBe(true);
  });

  it("returns false when comment lacks trigger phrase", () => {
    const context: any = {
      eventName: "issue_comment",
      entityNumber: 10,
      inputs: { triggerPhrase: "@greg", prompt: "" },
      payload: {
        comment: { body: "Just a regular comment between team members" },
      },
    };
    expect(checkContainsTrigger(context)).toBe(false);
  });
});
