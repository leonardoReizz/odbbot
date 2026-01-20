import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { MusicPlayer } from "@bot-discord/music";
import { spawn } from "child_process";
import "dotenv/config";

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("YouTube URL or search query")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your voice channel"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the voice channel"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip current track"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop and clear the queue"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the queue"),
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const player = new MusicPlayer({
  leaveOnEmpty: true,
  leaveOnEnd: true,
});

player.on("trackStart", (track) => {
  console.log(`Now playing: ${track.title}`);
});

player.on("trackEnd", (track) => {
  console.log(`Finished playing: ${track.title}`);
});

player.on("queueEnd", () => {
  console.log("Queue ended");
});

player.on("error", (error) => {
  console.error("Player error:", error);
});

interface VideoInfo {
  title: string;
  duration: number;
  thumbnail: string;
  url: string;
}

function isYouTubeUrl(query: string): boolean {
  return query.includes("youtube.com") || query.includes("youtu.be");
}

async function getVideoInfo(query: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    // If it's a search query, use ytsearch: prefix
    const searchQuery = isYouTubeUrl(query) ? query : `ytsearch1:${query}`;

    const proc = spawn("yt-dlp", [
      "--dump-json",
      "--no-playlist",
      "--no-warnings",
      searchQuery,
    ]);

    let data = "";
    proc.stdout.on("data", (chunk) => {
      data += chunk;
    });

    proc.stderr.on("data", (chunk) => {
      console.error("yt-dlp stderr:", chunk.toString());
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}`));
        return;
      }
      try {
        const json = JSON.parse(data);
        resolve({
          title: json.title,
          duration: json.duration || 0,
          thumbnail: json.thumbnail,
          url: json.webpage_url || json.url,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function getAudioStream(url: string) {
  const proc = spawn("yt-dlp", [
    "-f", "bestaudio",
    "-o", "-",
    "--no-playlist",
    "--no-warnings",
    url,
  ]);

  proc.stderr.on("data", (chunk) => {
    console.error("yt-dlp stderr:", chunk.toString());
  });

  return proc.stdout;
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot is ready! Logged in as ${readyClient.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

  try {
    console.log("Registering slash commands...");

    for (const guild of readyClient.guilds.cache.values()) {
      await rest.put(
        Routes.applicationGuildCommands(readyClient.user.id, guild.id),
        { body: commands }
      );
      console.log(`Commands registered for guild: ${guild.name}`);
    }
    console.log("Slash commands registered successfully!");
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const command = interaction.commandName;

  try {
    if (command === "play") {
      const query = interaction.options.getString("query", true);
      const member = interaction.guild.members.cache.get(interaction.user.id);
      const voiceChannel = member?.voice.channel;

      if (!voiceChannel) {
        await interaction.reply({
          content: "You need to be in a voice channel!",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      try {
        // Connect to voice channel if not already connected
        if (!player.getQueue(interaction.guild.id)) {
          await player.connect(voiceChannel);
        }

        // Get video info (works with URL or search query)
        const info = await getVideoInfo(query);

        // Get audio stream using the resolved URL
        const stream = getAudioStream(info.url);

        const track = {
          title: info.title,
          url: stream,
          duration: info.duration,
          thumbnail: info.thumbnail,
          requestedBy: interaction.user.tag,
        };

        await player.play(interaction.guild.id, track);

        await interaction.editReply(`Added to queue: **${track.title}**`);
      } catch (error) {
        console.error("Error playing track:", error);
        await interaction.editReply("Failed to play the track.");
      }
    }

    if (command === "join") {
      const member = interaction.guild.members.cache.get(interaction.user.id);
      const voiceChannel = member?.voice.channel;

      if (!voiceChannel) {
        await interaction.reply({
          content: "You need to be in a voice channel!",
          ephemeral: true,
        });
        return;
      }

      try {
        await player.connect(voiceChannel);
        await interaction.reply(`Joined ${voiceChannel.name}!`);
      } catch (error) {
        console.error(error);
        await interaction.reply({
          content: "Failed to join the voice channel.",
          ephemeral: true,
        });
      }
    }

    if (command === "leave") {
      player.disconnect(interaction.guild.id);
      await interaction.reply("Left the voice channel.");
    }

    if (command === "skip") {
      const skipped = player.skip(interaction.guild.id);
      await interaction.reply(skipped ? "Skipped!" : "Nothing to skip.");
    }

    if (command === "pause") {
      const paused = player.pause(interaction.guild.id);
      await interaction.reply(paused ? "Paused!" : "Failed to pause.");
    }

    if (command === "resume") {
      const resumed = player.resume(interaction.guild.id);
      await interaction.reply(resumed ? "Resumed!" : "Failed to resume.");
    }

    if (command === "stop") {
      player.stop(interaction.guild.id);
      await interaction.reply("Stopped and cleared the queue.");
    }

    if (command === "queue") {
      const queue = player.getQueue(interaction.guild.id);
      const currentTrack = player.getCurrentTrack(interaction.guild.id);

      if (!queue || (queue.isEmpty && !currentTrack)) {
        await interaction.reply("The queue is empty.");
        return;
      }

      let response = "";
      if (currentTrack) {
        response += `**Now playing:** ${currentTrack.title}\n\n`;
      }

      const tracks = queue.getAll();
      if (tracks.length > 0) {
        response += "**Queue:**\n";
        tracks.slice(0, 10).forEach((track, index) => {
          response += `${index + 1}. ${track.title}\n`;
        });

        if (tracks.length > 10) {
          response += `\n...and ${tracks.length - 10} more`;
        }
      }

      await interaction.reply(response || "The queue is empty.");
    }
  } catch (error) {
    console.error("Interaction error:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply("An error occurred.");
    } else {
      await interaction.reply({ content: "An error occurred.", ephemeral: true });
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN is required in .env file");
  process.exit(1);
}

client.login(token);
