import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  type AudioPlayer,
  type VoiceConnection,
  type DiscordGatewayAdapterCreator,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import { EventEmitter } from "events";
import { Queue } from "./queue";
import type { Track, PlayerOptions, PlayerEvents } from "./types";

export interface MusicPlayer {
  on<K extends keyof PlayerEvents>(
    event: K,
    listener: PlayerEvents[K]
  ): this;
  emit<K extends keyof PlayerEvents>(
    event: K,
    ...args: Parameters<PlayerEvents[K]>
  ): boolean;
}

export class MusicPlayer extends EventEmitter {
  private players: Map<string, AudioPlayer> = new Map();
  private connections: Map<string, VoiceConnection> = new Map();
  private queues: Map<string, Queue> = new Map();
  private currentTracks: Map<string, Track> = new Map();
  private options: PlayerOptions;

  constructor(options: PlayerOptions = {}) {
    super();
    this.options = {
      leaveOnEmpty: true,
      leaveOnEnd: true,
      leaveOnEmptyTimeout: 30000,
      ...options,
    };
  }

  async connect(channel: VoiceBasedChannel): Promise<VoiceConnection> {
    const guildId = channel.guild.id;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild
        .voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      connection.destroy();
      throw new Error("Failed to connect to voice channel");
    }

    this.connections.set(guildId, connection);

    if (!this.players.has(guildId)) {
      const player = createAudioPlayer();
      this.setupPlayerListeners(guildId, player);
      this.players.set(guildId, player);
      connection.subscribe(player);
    }

    if (!this.queues.has(guildId)) {
      this.queues.set(guildId, new Queue());
    }

    return connection;
  }

  private setupPlayerListeners(guildId: string, player: AudioPlayer): void {
    player.on(AudioPlayerStatus.Idle, () => {
      const currentTrack = this.currentTracks.get(guildId);
      if (currentTrack) {
        this.emit("trackEnd", currentTrack);
        this.currentTracks.delete(guildId);
      }

      const queue = this.queues.get(guildId);
      if (queue && !queue.isEmpty) {
        this.playNext(guildId);
      } else {
        this.emit("queueEnd");
        if (this.options.leaveOnEnd) {
          this.disconnect(guildId);
        }
      }
    });

    player.on("error", (error) => {
      this.emit("error", error);
    });
  }

  async play(guildId: string, track: Track): Promise<void> {
    const queue = this.queues.get(guildId);
    if (!queue) {
      throw new Error("Not connected to a voice channel in this guild");
    }

    queue.add(track);

    const player = this.players.get(guildId);
    if (player && player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext(guildId);
    }
  }

  private async playNext(guildId: string): Promise<void> {
    const queue = this.queues.get(guildId);
    const player = this.players.get(guildId);

    if (!queue || !player) return;

    const track = queue.next();
    if (!track) return;

    try {
      const resource = createAudioResource(track.url);
      player.play(resource);
      this.currentTracks.set(guildId, track);
      this.emit("trackStart", track);
    } catch (error) {
      this.emit("error", error as Error);
      await this.playNext(guildId);
    }
  }

  skip(guildId: string): boolean {
    const player = this.players.get(guildId);
    if (!player) return false;

    player.stop();
    return true;
  }

  pause(guildId: string): boolean {
    const player = this.players.get(guildId);
    if (!player) return false;

    return player.pause();
  }

  resume(guildId: string): boolean {
    const player = this.players.get(guildId);
    if (!player) return false;

    return player.unpause();
  }

  stop(guildId: string): void {
    const queue = this.queues.get(guildId);
    const player = this.players.get(guildId);

    if (queue) queue.clear();
    if (player) player.stop();

    this.currentTracks.delete(guildId);
  }

  disconnect(guildId: string): void {
    const connection = this.connections.get(guildId);
    const player = this.players.get(guildId);

    if (player) {
      player.stop();
      this.players.delete(guildId);
    }

    if (connection) {
      connection.destroy();
      this.connections.delete(guildId);
    }

    this.queues.delete(guildId);
    this.currentTracks.delete(guildId);
  }

  getQueue(guildId: string): Queue | undefined {
    return this.queues.get(guildId);
  }

  getCurrentTrack(guildId: string): Track | undefined {
    return this.currentTracks.get(guildId);
  }

  isPlaying(guildId: string): boolean {
    const player = this.players.get(guildId);
    return player?.state.status === AudioPlayerStatus.Playing;
  }

  isPaused(guildId: string): boolean {
    const player = this.players.get(guildId);
    return player?.state.status === AudioPlayerStatus.Paused;
  }
}
