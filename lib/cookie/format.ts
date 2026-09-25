/**
 * Numbers the way the game shows them: commas up to a million, then a name for
 * every power of a thousand ("1.5 million", "12.345 quattuordecillion"), or a
 * short suffix ("1.5M") if the reader prefers.
 */

const LONG_SMALL = ["million", "billion", "trillion", "quadrillion", "quintillion", "sextillion", "septillion", "octillion", "nonillion"];
const LONG_UNITS = ["", "un", "duo", "tre", "quattuor", "quin", "sex", "septen", "octo", "novem"];
const LONG_TENS = [
  "decillion",
  "vigintillion",
  "trigintillion",
  "quadragintillion",
  "quinquagintillion",
  "sexagintillion",
  "septuagintillion",
  "octogintillion",
  "nonagintillion",
];

const SHORT_SMALL = ["M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No"];
const SHORT_UNITS = ["", "Un", "Do", "Tr", "Qa", "Qi", "Sx", "Sp", "Oc", "No"];
const SHORT_TENS = ["Dc", "Vg", "Tg", "Qag", "Qig", "Sxg", "Spg", "Ocg", "Nog"];

/** The name of 1000^(n + 1): n = 1 is a million, n = 10 a decillion. */
function scaleName(n: number, short: boolean): string | null {
  if (n < 1) return null;
  if (n < 10) return (short ? SHORT_SMALL : LONG_SMALL)[n - 1];
  if (n < 100) return (short ? SHORT_UNITS : LONG_UNITS)[n % 10] + (short ? SHORT_TENS : LONG_TENS)[Math.floor(n / 10) - 1];
  return null;
}

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const withDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export interface FormatOptions {
  short?: boolean;
  /** Show one decimal place below a million, for rates like 0.1 per second. */
  decimal?: boolean;
}

export function formatNumber(value: number, { short = false, decimal = false }: FormatOptions = {}): string {
  if (Number.isNaN(value)) return "0";
  if (!Number.isFinite(value)) return value > 0 ? "infinity" : "-infinity";
  const sign = value < 0 ? "-" : "";
  const size = Math.abs(value);

  if (size < 1e6) {
    const text = (decimal ? withDecimal : grouped).format(decimal ? size : Math.floor(size));
    return text === "0" ? "0" : sign + text;
  }

  // Which power of a thousand, checked both ways because logarithms of exact
  // powers can land a hair either side of the integer.
  let power = Math.floor(Math.log10(size) / 3);
  if (size >= 1000 ** (power + 1)) power += 1;
  if (size < 1000 ** power) power -= 1;
  let mantissa = Math.round((size / 1000 ** power) * 1000) / 1000;
  if (mantissa >= 1000) {
    power += 1;
    mantissa = Math.round((size / 1000 ** power) * 1000) / 1000;
  }

  const name = scaleName(power - 1, short);
  if (!name) return sign + size.toExponential(3).replace("e+", "e");
  return short ? `${sign}${mantissa}${name}` : `${sign}${mantissa} ${name}`;
}

/** "1:17", for a buff counting down. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

const UNITS: [name: string, seconds: number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

const unit = (amount: number, name: string) => `${grouped.format(amount)} ${name}${amount === 1 ? "" : "s"}`;

/** "2 hours, 5 minutes": the largest unit, and the one under it if it isn't zero. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const first = UNITS.findIndex(([, size]) => whole >= size);
  if (first === -1) return "0 seconds";
  const [name, size] = UNITS[first];
  const amount = Math.floor(whole / size);
  const next = UNITS[first + 1];
  const rest = next ? Math.floor((whole - amount * size) / next[1]) : 0;
  return rest > 0 ? `${unit(amount, name)}, ${unit(rest, next[0])}` : unit(amount, name);
}
