import { ActivityType, type LanyardActivity, type LanyardData } from "./types";

/**
 * A description of what someone is doing, written to complete the sentence
 * "right now i'm ___". `key` changes whenever the visible text should
 * transition, so it can be used directly as a React key.
 */
export interface Presence {
  phrase: string;
  key: string;
  kind: "around" | "away" | "busy" | "activity";
}

export const FALLBACK_PRESENCE: Presence = {
  phrase: "away from the keyboard",
  key: "away",
  kind: "away",
};

const MAX_PHRASE_LENGTH = 100;

const VERB_BY_TYPE: Record<number, string> = {
  [ActivityType.Playing]: "playing",
  [ActivityType.Streaming]: "streaming",
  [ActivityType.Watching]: "watching",
  [ActivityType.Competing]: "competing in",
};

/** Lanyard joins multiple artists with "; ". Keep it readable. */
export function formatArtists(raw: string): string {
  const artists = raw
    .split(";")
    .map((a) => a.trim())
    .filter(Boolean);
  if (artists.length <= 1) return artists[0] ?? raw.trim();
  if (artists.length === 2) return `${artists[0]} and ${artists[1]}`;
  return artists[0];
}

function pickActivity(activities: LanyardActivity[]): LanyardActivity | undefined {
  const describable = activities.filter(
    (a) =>
      a.type !== ActivityType.Custom &&
      a.type !== ActivityType.Listening &&
      a.name &&
      a.name.toLowerCase() !== "spotify",
  );
  // Prefer the thing that started most recently; it's most likely what's on screen.
  return describable.sort(
    (a, b) => (b.timestamps?.start ?? b.created_at ?? 0) - (a.timestamps?.start ?? a.created_at ?? 0),
  )[0];
}

function describeActivity(activity: LanyardActivity): string {
  const verb = VERB_BY_TYPE[activity.type] ?? "playing";
  return `${verb} ${activity.name.trim()}`;
}

function describeSpotify(data: LanyardData): { full: string; short: string } | null {
  if (!data.listening_to_spotify || !data.spotify?.song) return null;
  const song = data.spotify.song.trim();
  const artist = data.spotify.artist ? formatArtists(data.spotify.artist) : "";
  return {
    full: artist ? `listening to ${song} by ${artist}` : `listening to ${song}`,
    short: `listening to ${song}`,
  };
}

export function describePresence(data: LanyardData | null | undefined): Presence {
  if (!data) return FALLBACK_PRESENCE;

  const activity = pickActivity(data.activities ?? []);
  const spotify = describeSpotify(data);

  if (activity || spotify) {
    const game = activity ? describeActivity(activity) : null;

    // Try the most complete sentence first, then progressively simpler ones.
    const candidates: string[] = [];
    if (game && spotify) {
      candidates.push(`${game} and ${spotify.full}`);
      candidates.push(`${game} and ${spotify.short}`);
      candidates.push(`${game} with music on`);
    } else if (game) {
      candidates.push(game);
    } else if (spotify) {
      candidates.push(spotify.full);
      candidates.push(spotify.short);
      candidates.push("listening to music");
    }

    const phrase =
      candidates.find((c) => c.length <= MAX_PHRASE_LENGTH) ?? candidates[candidates.length - 1];

    return { phrase, key: `activity:${phrase}`, kind: "activity" };
  }

  switch (data.discord_status) {
    case "online":
      return { phrase: "around", key: "around", kind: "around" };
    case "dnd":
      return { phrase: "heads down", key: "busy", kind: "busy" };
    case "idle":
    case "offline":
    default:
      return FALLBACK_PRESENCE;
  }
}
