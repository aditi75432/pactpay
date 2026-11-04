/**
 * Speech-to-text writes "one hundred dollars" where a shopper would type "$100". Rule drafting reads digits far more
 * reliably, so spoken amounts are normalized before the text is used: "under fifty dollars" becomes "under $50".
 * Single small numbers ("one mouse") are left alone unless a currency word follows.
 */
const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const CURRENCY = /^(dollars?|bucks?|usd)$/i;

function isNumberWord(word: string): boolean {
  const w = word.toLowerCase();
  return w in UNITS || w in TENS || w === "hundred" || w === "thousand" || w === "a" && false;
}

function parseRun(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const raw of words) {
    const w = raw.toLowerCase();
    if (w === "and") continue;
    if (w in UNITS) { current += UNITS[w]!; seen = true; }
    else if (w in TENS) { current += TENS[w]!; seen = true; }
    else if (w === "hundred") { current = (current === 0 ? 1 : current) * 100; seen = true; }
    else if (w === "thousand") { total += (current === 0 ? 1 : current) * 1000; current = 0; seen = true; }
    else return null;
  }
  return seen ? total + current : null;
}

export function normalizeSpokenNumbers(input: string): string {
  const hyphenated = input.replace(/\b(twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/gi, "$1 $2");
  const parts = hyphenated.split(/(\s+)/);
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i]!;
    const bare = part.replace(/[^A-Za-z]/g, "");
    const lead = /^"?a$/i.test(bare) && i + 2 < parts.length && /^(hundred|thousand)/i.test(parts[i + 2]!.replace(/[^A-Za-z]/g, ""));
    if (!isNumberWord(bare) && !lead) { out.push(part); i += 1; continue; }
    // Collect a run of number words (and "and" between them), with their separators.
    const words: string[] = [];
    let j = i;
    let end = i;
    while (j < parts.length) {
      const token = parts[j]!;
      if (/^\s+$/.test(token)) { j += 1; continue; }
      const w = token.replace(/[^A-Za-z]/g, "");
      const trailingPunct = /[.,;:!?]$/.test(token);
      if (isNumberWord(w) || (words.length === 0 && lead && j === i) || (w.toLowerCase() === "and" && words.length > 0 && j + 2 < parts.length && isNumberWord(parts[j + 2]!.replace(/[^A-Za-z]/g, "")) && /hundred|thousand/i.test(words[words.length - 1]!))) {
        if (!(words.length === 0 && lead && j === i)) words.push(w); else words.push("one");
        end = j;
        j += 1;
        if (trailingPunct) break;
      } else break;
    }
    const value = parseRun(words);
    const nextWord = parts.slice(end + 1).find((p) => !/^\s+$/.test(p))?.replace(/[^A-Za-z]/g, "") ?? "";
    const currencyFollows = CURRENCY.test(nextWord);
    if (value !== null && (value >= 10 || currencyFollows)) {
      const trailing = /[.,;:!?]$/.exec(parts[end]!)?.[0] ?? "";
      out.push(String(value) + trailing);
      i = end + 1;
    } else {
      out.push(part);
      i += 1;
    }
  }
  return out.join("").replace(/(?<![\d$.,])\b(\d[\d,]*(?:\.\d+)?)\s*(?:dollars?|bucks?|usd)\b/gi, (_m, n: string) => `$${n}`).replace(/\$\s+(\d)/g, "$$$1");
}
