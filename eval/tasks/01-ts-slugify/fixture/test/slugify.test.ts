import { expect, test } from "bun:test";
import { slugify } from "../src/slugify";

test("lower-cases", () => expect(slugify("Hello World")).toBe("hello-world"));
test("collapses punctuation and spaces", () => expect(slugify("Hello,   World!!")).toBe("hello-world"));
test("trims leading and trailing dashes", () => expect(slugify("  --Hello-- ")).toBe("hello"));
test("keeps digits", () => expect(slugify("Top 10 Tips")).toBe("top-10-tips"));
test("empty stays empty", () => expect(slugify("")).toBe(""));
