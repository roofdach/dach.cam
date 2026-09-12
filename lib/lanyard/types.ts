export type DiscordStatus = "online" | "idle" | "dnd" | "offline";

/** Discord activity types. https://discord.com/developers/docs/topics/gateway-events#activity-object-activity-types */
export const ActivityType = {
  Playing: 0,
  Streaming: 1,
  Listening: 2,
  Watching: 3,
  Custom: 4,
  Competing: 5,
} as const;

export interface LanyardTimestamps {
  start?: number;
  end?: number;
}

export interface LanyardActivity {
  id: string;
  name: string;
  type: number;
  state?: string;
  details?: string;
  application_id?: string;
  created_at?: number;
  timestamps?: LanyardTimestamps;
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
}

export interface LanyardSpotify {
  track_id: string | null;
  timestamps: LanyardTimestamps;
  song: string;
  artist: string;
  album: string;
  album_art_url: string | null;
}

export interface LanyardUser {
  id: string;
  username: string;
  display_name?: string | null;
  global_name?: string | null;
  avatar: string | null;
}

export interface LanyardData {
  discord_user: LanyardUser;
  discord_status: DiscordStatus;
  activities: LanyardActivity[];
  listening_to_spotify: boolean;
  spotify: LanyardSpotify | null;
  active_on_discord_desktop?: boolean;
  active_on_discord_mobile?: boolean;
  active_on_discord_web?: boolean;
  kv?: Record<string, string>;
}

export type LanyardSocketOp = 0 | 1 | 2 | 3;

export interface LanyardHello {
  op: 1;
  d: { heartbeat_interval: number };
}

export interface LanyardEvent {
  op: 0;
  t: "INIT_STATE" | "PRESENCE_UPDATE";
  d: LanyardData;
}

export type LanyardIncoming = LanyardHello | LanyardEvent | { op: number; t?: string; d?: unknown };

export interface LanyardRestResponse {
  success: boolean;
  data?: LanyardData;
  error?: { code: string; message: string };
}

export type LanyardConnectionState = "connecting" | "live" | "failed";
