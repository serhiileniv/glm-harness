/** Turn a title into a URL slug: lower-case, words joined by single dashes, no leading or trailing dashes. */
export function slugify(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/--+/g, "-");
}
