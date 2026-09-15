import { expect, test } from "bun:test";
import { parseDuration } from "../src/duration";

test("hours and minutes", () => expect(parseDuration("1h30m")).toBe(5_400_000));
test("seconds", () => expect(parseDuration("45s")).toBe(45_000));
test("milliseconds", () => expect(parseDuration("500ms")).toBe(500));
test("hours only", () => expect(parseDuration("2h")).toBe(7_200_000));
test("all units", () => expect(parseDuration("1h1m1s1ms")).toBe(3_661_001));
test("rejects garbage", () => expect(() => parseDuration("soon")).toThrow());
test("rejects empty", () => expect(() => parseDuration("")).toThrow());
