import type { VoiceConnection } from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";

import type { Readable } from "stream";

export type TrackSource = string | Readable;

export interface Track {
  title: string;
  url: TrackSource;
  duration: number;
  thumbnail?: string;
  requestedBy?: string;
}

export interface PlayerOptions {
  leaveOnEmpty?: boolean;
  leaveOnEnd?: boolean;
  leaveOnEmptyTimeout?: number;
}

export interface PlayerEvents {
  trackStart: (track: Track) => void;
  trackEnd: (track: Track) => void;
  queueEnd: () => void;
  error: (error: Error) => void;
}

export interface GuildPlayer {
  guildId: string;
  voiceChannel: VoiceBasedChannel;
  connection: VoiceConnection | null;
  queue: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
}
