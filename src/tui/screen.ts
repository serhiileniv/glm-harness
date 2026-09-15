import { clip } from "./buffer";

/** Alternate-screen terminal control. Everything it turns on, `leave()` turns off. */
export class Screen {
  cols = 80;
  rows = 24;
  private active = false;
  private keyCb?: (data: string) => void;
  private resizeCb?: () => void;
  private readonly onData = (b: Buffer) => this.keyCb?.(b.toString("utf8"));
  private readonly onResize = () => {
    this.measure();
    this.resizeCb?.();
  };

  constructor(private readonly out: NodeJS.WriteStream = process.stdout, private readonly inp: NodeJS.ReadStream = process.stdin) {}

  measure(): void {
    // GLMH_COLS / GLMH_ROWS exist for automated checks in pseudo-terminals that cannot set a window size.
    this.cols = Number(process.env.GLMH_COLS) || this.out.columns || 80;
    this.rows = Number(process.env.GLMH_ROWS) || this.out.rows || 24;
  }

  enter(): void {
    if (this.active) return;
    this.measure();
    this.inp.setRawMode?.(true);
    this.inp.resume();
    this.inp.on("data", this.onData);
    this.out.on("resize", this.onResize);
    // alt screen, hide cursor, no autowrap, bracketed paste, clear
    this.out.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h\x1b[H\x1b[2J");
    this.active = true;
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.out.write("\x1b[?2004l\x1b[?7h\x1b[0m\x1b[?25h\x1b[?1049l");
    this.inp.off("data", this.onData);
    this.out.off("resize", this.onResize);
    this.inp.setRawMode?.(false);
    this.inp.pause();
  }

  onKeys(cb: (data: string) => void): void {
    this.keyCb = cb;
  }

  onResizeEvent(cb: () => void): void {
    this.resizeCb = cb;
  }

  clear(): void {
    this.out.write("\x1b[2J");
  }

  /** Overwrite the whole frame in one write: home, each row with clear-to-EOL, then place the cursor. */
  draw(lines: string[], cursor: { row: number; col: number } | null): void {
    const rows = lines.slice(0, this.rows);
    while (rows.length < this.rows) rows.push("");
    let s = "\x1b[?25l\x1b[H";
    s += rows.map((l) => clip(l, this.cols) + "\x1b[0m\x1b[K").join("\r\n");
    if (cursor) s += `\x1b[${cursor.row + 1};${Math.min(this.cols, cursor.col + 1)}H\x1b[?25h`;
    this.out.write(s);
  }
}
