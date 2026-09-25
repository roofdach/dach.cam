import * as engine from "@/lib/cookie/engine";
import type { GameState, Notice, Production, Settings } from "@/lib/cookie/engine";
import { formatNumber } from "@/lib/cookie/format";
import { BROKEN_SAVE_KEY, SAVE_KEY, decodeImport, encodeExport, parseSave, serialize } from "@/lib/cookie/save";

/**
 * The game as it runs in a tab: the loop, the saving, and making sure only
 * one tab plays at a time.
 *
 * Two tabs playing the same save would each overwrite the other's progress,
 * so a tab that opens asks any other to save and step aside, then loads what
 * that tab just saved. A tab that missed the message finds out the next time
 * it goes to save, because the save says which tab wrote it.
 */

export type Status = "starting" | "playing" | "elsewhere";

const AUTOSAVE_MS = 30_000;
/** How long a new tab waits for an open one to save and step aside. */
const HANDOFF_MS = 250;
/** How often unlocks and achievements are looked at. */
const CHECK_MS = 250;
/** Shorter than this away isn't worth a "welcome back". */
const OFFLINE_MIN_SECONDS = 60;
const CHANNEL = "cookie-clicker";

type Message =
  | { type: "claim"; from: string; at: number }
  /** Carries the save, because the copy in localStorage can take a moment to reach another tab. */
  | { type: "released"; from: string; to: string; save: string };

const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function readStorage(): { text: string | null; available: boolean } {
  try {
    return { text: window.localStorage.getItem(SAVE_KEY), available: true };
  } catch {
    return { text: null, available: false };
  }
}

function ownerOf(text: string | null): string {
  if (!text) return "";
  try {
    const owner = (JSON.parse(text) as { owner?: unknown }).owner;
    return typeof owner === "string" ? owner : "";
  } catch {
    return "";
  }
}

export class CookieGame {
  state: GameState;
  status: Status = "starting";
  /** False while the browser refuses to save. */
  canSave = true;
  /** When the game last saved, in milliseconds since the epoch. */
  lastSaved = 0;
  /** Goes up whenever the whole game is swapped for another: a load, an import, a wipe. */
  generation = 0;
  /** The time as of the last update, for anything on screen that counts time. */
  now = Date.now();

  private readonly id = newId();
  private listeners = new Set<() => void>();
  private noticeListeners = new Set<(notices: Notice[]) => void>();
  private channel: BroadcastChannel | null = null;
  private running = false;
  private claimedAt = 0;
  private handoff = 0;
  private frame = 0;
  private ticker = 0;
  private lastTick = 0;
  private lastCheck = 0;
  private title = "";
  private version = 0;
  private made: Production | null = null;
  private madeAt = -1;

  constructor() {
    // Only read here: this can run more than once, and before anything is on screen.
    const { text, available } = readStorage();
    this.canSave = available;
    this.state = (text && parseSave(text, Date.now())?.state) || engine.newGame(Date.now());
    this.state.notices = [];
  }

  /* ------------------------------------------------------ subscriptions */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Everything that happened in one update arrives together, so it can be told together. */
  onNotices = (listener: (notices: Notice[]) => void) => {
    this.noticeListeners.add(listener);
    return () => {
      this.noticeListeners.delete(listener);
    };
  };

  private emit() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Production as of the latest update, worked out once however many things ask. */
  production(): Production {
    if (!this.made || this.madeAt !== this.version) {
      this.made = engine.production(this.state);
      this.madeAt = this.version;
    }
    return this.made;
  }

  private replace(state: GameState) {
    this.state = state;
    this.state.notices = [];
    this.generation += 1;
  }

  /** Hands anything the engine had to say to the page, then redraws. */
  private flush() {
    const notices = this.state.notices.splice(0);
    if (notices.length) for (const listener of this.noticeListeners) listener(notices);
    this.emit();
  }

  /* ---------------------------------------------------------- lifecycle */

  start() {
    if (this.running) return;
    this.running = true;
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = this.onMessage;
    }
    window.addEventListener("storage", this.onStorage);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.claim();
  }

  stop() {
    if (!this.running) return;
    if (this.status === "playing") {
      this.tick(document.visibilityState === "visible");
      this.save({ releasing: true });
    }
    this.running = false;
    this.halt();
    window.clearTimeout(this.handoff);
    window.removeEventListener("storage", this.onStorage);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("pageshow", this.onPageShow);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.channel?.close();
    this.channel = null;
    this.status = "starting";
  }

  /** Asks any other open tab to save and step aside, then plays. */
  private claim() {
    this.halt();
    window.clearTimeout(this.handoff);
    this.status = "starting";
    this.claimedAt = Date.now();
    // A tab lets go of the save as it closes, so if nobody holds it, nobody
    // else is playing and there's nothing to wait for.
    if (!this.channel || !ownerOf(readStorage().text)) {
      this.activate();
      return;
    }
    this.emit();
    this.post({ type: "claim", from: this.id, at: this.claimedAt });
    this.handoff = window.setTimeout(() => this.activate(), HANDOFF_MS);
  }

  /** Starts playing, from the save a tab just handed over if there is one, or from storage. */
  private activate(handedOver?: string) {
    window.clearTimeout(this.handoff);
    if (!this.running || this.status === "playing") return;
    const now = Date.now();
    const stored = readStorage();
    const text = handedOver ?? stored.text;
    this.canSave = stored.available;
    let away = 0;
    if (text) {
      const loaded = parseSave(text, now);
      if (loaded) {
        this.replace(loaded.state);
        away = (now - loaded.savedAt) / 1000;
      } else {
        this.backUp(text);
      }
    }
    this.state.notices = [];
    this.status = "playing";
    this.lastTick = now;
    this.now = now;
    if (away >= OFFLINE_MIN_SECONDS) engine.applyOffline(this.state, away);
    this.check(now);
    // Writing straight away is what tells any other tab this one is playing now.
    this.save({ claiming: true });
    this.flush();
    this.updateTitle();
    this.frame = requestAnimationFrame(this.onFrame);
    this.ticker = window.setInterval(this.onSecond, 1000);
  }

  /** Stops the loop, and whatever else was keeping this tab playing. */
  private halt() {
    cancelAnimationFrame(this.frame);
    window.clearInterval(this.ticker);
  }

  private stepAside() {
    this.halt();
    this.status = "elsewhere";
    this.updateTitle();
    this.emit();
  }

  /** For the "play here" button in a tab that stepped aside. */
  takeOver() {
    if (this.running && this.status === "elsewhere") this.claim();
  }

  private post(message: Message) {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel. Saves still carry who wrote them.
    }
  }

  private onMessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "claim" && message.from !== this.id) {
      if (this.status === "playing") {
        this.tick(document.visibilityState === "visible");
        const save = serialize(this.state, Date.now(), this.id);
        // Only the tab that really holds the save hands it over. One that
        // turns out not to (it missed a takeover) just steps aside quietly.
        const held = this.save();
        this.stepAside();
        if (held) this.post({ type: "released", from: this.id, to: message.from, save });
      } else if (this.status === "starting") {
        // Two tabs opening at once: the later one plays, and a tie goes to the larger id.
        if (message.at > this.claimedAt || (message.at === this.claimedAt && message.from > this.id)) {
          window.clearTimeout(this.handoff);
          this.stepAside();
        }
      }
    } else if (message.type === "released" && message.to === this.id && this.status === "starting") {
      this.activate(typeof message.save === "string" ? message.save : undefined);
    }
  };

  private onStorage = (event: StorageEvent) => {
    // Only the playing tab writes the save, so a write from anywhere else means that's where the game is now.
    if (event.key !== SAVE_KEY || event.newValue === null || this.status !== "playing") return;
    // Storage events can arrive late, after messages sent later: the last
    // save a tab made before handing over can land after this tab took over.
    // So what counts is who holds the save now, not who wrote this event.
    const owner = ownerOf(readStorage().text);
    if (owner && owner !== this.id) this.stepAside();
  };

  private onVisibility = () => {
    if (this.status !== "playing") return;
    if (document.visibilityState === "hidden") {
      // Everything up to now was spent on screen.
      this.tick(true);
      this.save();
    } else {
      // And everything up to now was spent off it.
      this.tick(false);
    }
  };

  private onPageHide = () => {
    if (this.status !== "playing") return;
    this.tick(document.visibilityState === "visible");
    this.save({ releasing: true });
  };

  private onPageShow = (event: PageTransitionEvent) => {
    // Back from the back/forward cache: another tab may have played in the meantime.
    if (event.persisted && this.running) this.claim();
  };

  /* --------------------------------------------------------------- loop */

  private onFrame = () => {
    if (this.status !== "playing") return;
    this.tick(true);
    this.frame = requestAnimationFrame(this.onFrame);
  };

  private onSecond = () => {
    if (this.status !== "playing") return;
    // Frames stop in a hidden tab; this keeps it baking.
    if (document.visibilityState !== "visible") this.tick(false);
    if (Date.now() - this.lastSaved >= AUTOSAVE_MS) this.save();
    this.updateTitle();
  };

  /** Moves the game on to now. Golden cookies only move on while `visible`. */
  private tick(visible: boolean) {
    const now = Date.now();
    const seconds = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.now = now;
    if (seconds > 0) engine.advance(this.state, seconds, visible);
    if (now - this.lastCheck >= CHECK_MS) this.check(now);
    this.flush();
  }

  private check(now = Date.now()) {
    this.lastCheck = now;
    engine.refreshUnlocks(this.state);
    engine.checkAchievements(this.state, now);
  }

  private updateTitle() {
    // The page's own title, remembered once. It's never put back on the way
    // out: by then the next page has set its own.
    if (!this.title) this.title = document.title || "cookie";
    if (this.status === "elsewhere") {
      document.title = `${this.title} (paused)`;
      return;
    }
    const cookies = Math.floor(this.state.run.cookies);
    const amount = formatNumber(cookies, { short: this.state.settings.numbers === "short" });
    document.title = `${amount} ${cookies === 1 ? "cookie" : "cookies"} · ${this.title}`;
  }

  /* ------------------------------------------------------------- saving */

  /**
   * Saves, unless another tab has started writing the save. `claiming` writes
   * regardless, to take the save over; `releasing` lets go of it, for a tab
   * that's closing.
   */
  save({ claiming = false, releasing = false } = {}): boolean {
    if (this.status !== "playing") return false;
    const now = Date.now();
    try {
      if (!claiming) {
        const owner = ownerOf(window.localStorage.getItem(SAVE_KEY));
        if (owner && owner !== this.id) {
          this.stepAside();
          return false;
        }
      }
      window.localStorage.setItem(SAVE_KEY, serialize(this.state, now, releasing ? "" : this.id));
      this.lastSaved = now;
      if (!this.canSave) {
        this.canSave = true;
        this.emit();
      }
      return true;
    } catch {
      if (this.canSave) {
        this.canSave = false;
        this.emit();
      }
      return false;
    }
  }

  /** Keeps a save this version can't read, rather than writing over it. */
  private backUp(text: string) {
    try {
      if (!window.localStorage.getItem(BROKEN_SAVE_KEY)) window.localStorage.setItem(BROKEN_SAVE_KEY, text);
    } catch {
      // Nowhere to put it.
    }
  }

  /* ------------------------------------------------------------ actions */

  private act(action: () => boolean): boolean {
    if (this.status !== "playing") return false;
    const changed = action();
    if (changed) {
      this.check();
      this.flush();
    }
    return changed;
  }

  click(): number {
    if (this.status !== "playing") return 0;
    const value = engine.clickCookie(this.state, performance.now());
    if (value > 0) this.emit();
    return value;
  }

  buyBuilding = (index: number, amount: number) => this.act(() => engine.buyBuilding(this.state, index, amount));

  sellBuilding = (index: number, amount: number) => this.act(() => engine.sellBuilding(this.state, index, amount) > 0);

  buyUpgrade = (id: string) => this.act(() => engine.buyUpgrade(this.state, id));

  clickGolden = () => this.act(() => engine.clickGolden(this.state) !== null);

  clickNews = () =>
    this.act(() => {
      engine.clickNews(this.state);
      return true;
    });

  ascend = () => {
    const done = this.act(() => {
      engine.ascend(this.state, Date.now());
      return true;
    });
    if (done) this.save();
    return done;
  };

  buyHeavenly = (id: string) => {
    const done = this.act(() => engine.buyHeavenly(this.state, id));
    if (done) this.save();
    return done;
  };

  reincarnate = () => {
    const done = this.act(() => {
      engine.reincarnate(this.state, Date.now());
      return true;
    });
    if (done) {
      this.lastTick = Date.now();
      this.save();
    }
    return done;
  };

  setSettings = (patch: Partial<Settings>) => {
    if (this.status !== "playing") return;
    Object.assign(this.state.settings, patch);
    this.save();
    this.updateTitle();
    this.emit();
  };

  exportSave = () => encodeExport(serialize(this.state, Date.now(), ""));

  /** Replaces the game with a pasted save. Returns false if it isn't one. */
  importSave = (text: string) => {
    if (this.status !== "playing") return false;
    const json = decodeImport(text);
    const loaded = json ? parseSave(json, Date.now()) : null;
    if (!loaded) return false;
    this.replace(loaded.state);
    this.lastTick = Date.now();
    this.check();
    this.save();
    this.flush();
    this.updateTitle();
    return true;
  };

  /** Starts again from nothing. Settings are the one thing kept. */
  wipe = () => {
    if (this.status !== "playing") return;
    const settings = { ...this.state.settings };
    this.replace(engine.newGame(Date.now()));
    this.state.settings = settings;
    this.lastTick = Date.now();
    this.save();
    this.flush();
    this.updateTitle();
  };
}
