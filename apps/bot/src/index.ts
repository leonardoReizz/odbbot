import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { LavalinkManager } from "lavalink-client";
import "dotenv/config";

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Tocar uma música do YouTube")
    .addStringOption((o) =>
      o.setName("query").setDescription("URL ou nome da música").setRequired(true)
    ),
  new SlashCommandBuilder().setName("skip").setDescription("Pular a música atual"),
  new SlashCommandBuilder().setName("pause").setDescription("Pausar"),
  new SlashCommandBuilder().setName("resume").setDescription("Retomar"),
  new SlashCommandBuilder().setName("stop").setDescription("Parar e limpar a fila"),
  new SlashCommandBuilder().setName("queue").setDescription("Ver a fila"),
  new SlashCommandBuilder().setName("leave").setDescription("Sair do canal de voz"),
].map((c) => c.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const lavalink = new LavalinkManager({
  nodes: [
    {
      authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass",
      host: process.env.LAVALINK_HOST || "localhost",
      port: Number(process.env.LAVALINK_PORT) || 2333,
      id: "main",
    },
  ],
  sendToShard: (guildId: string, payload: any) =>
    client.guilds.cache.get(guildId)?.shard?.send(payload),
  client: { id: process.env.CLIENT_ID!, username: "ODB" },
  playerOptions: {
    defaultSearchPlatform: "ytsearch",
    onDisconnect: { destroyPlayer: true },
    onEmptyQueue: { destroyAfterMs: 30_000 },
  },
});

lavalink.on("trackStart", (player, track) => {
  console.log(`Tocando: ${track.info.title}`);
});

lavalink.on("trackEnd", (player, track) => {
  console.log(`Terminou: ${track.info.title}`);
});

lavalink.on("queueEnd", (player) => {
  console.log("Fila vazia");
});

client.on("raw", (d) => lavalink.sendRawData(d));

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot online: ${readyClient.user.tag}`);

  await lavalink.init({ id: readyClient.user.id, username: readyClient.user.username });

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);
  for (const guild of readyClient.guilds.cache.values()) {
    await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guild.id), {
      body: commands,
    });
  }
  console.log("Comandos registrados!");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const { commandName, guild } = interaction;

  if (commandName === "play") {
    const query = interaction.options.getString("query", true);
    const member = guild.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice.channel;

    if (!voiceChannel) {
      return void interaction.reply({ content: "Entre em um canal de voz primeiro!", ephemeral: true });
    }

    try {
      await interaction.deferReply();
    } catch {
      return;
    }

    try {
      const player = lavalink.createPlayer({
        guildId: guild.id,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
      });

      if (!player.connected) await player.connect();

      const result = await player.search({ query }, interaction.user);

      if (!result.tracks.length) {
        return void interaction.editReply("Nenhum resultado encontrado.");
      }

      const track = result.tracks[0];
      await player.queue.add(track);

      if (!player.playing) await player.play();

      await interaction.editReply(`Adicionado: **${track.info.title}**`);
    } catch (err) {
      console.error("Erro ao tocar:", err);
      try { await interaction.editReply("Erro ao tocar a música."); } catch {}
    }
    return;
  }

  if (commandName === "skip") {
    try {
      const player = lavalink.getPlayer(guild.id);
      if (!player) return void interaction.reply("Não estou tocando nada.");
      await player.skip();
      await interaction.reply("Pulado!");
    } catch (err) {
      console.error("Erro ao pular:", err);
      try { await interaction.reply("Não há próxima música na fila."); } catch {}
    }
    return;
  }

  if (commandName === "pause") {
    try {
      const player = lavalink.getPlayer(guild.id);
      if (!player) return void interaction.reply("Não estou tocando nada.");
      await player.pause();
      await interaction.reply("Pausado!");
    } catch (err) {
      console.error("Erro ao pausar:", err);
      try { await interaction.reply("Erro ao pausar."); } catch {}
    }
    return;
  }

  if (commandName === "resume") {
    try {
      const player = lavalink.getPlayer(guild.id);
      if (!player) return void interaction.reply("Não estou tocando nada.");
      await player.resume();
      await interaction.reply("Retomado!");
    } catch (err) {
      console.error("Erro ao retomar:", err);
      try { await interaction.reply("Erro ao retomar."); } catch {}
    }
    return;
  }

  if (commandName === "stop") {
    try {
      const player = lavalink.getPlayer(guild.id);
      if (!player) return void interaction.reply("Não estou tocando nada.");
      await player.destroy();
      await interaction.reply("Parado e fila limpa.");
    } catch (err) {
      console.error("Erro ao parar:", err);
      try { await interaction.reply("Erro ao parar."); } catch {}
    }
    return;
  }

  if (commandName === "leave") {
    try {
      const player = lavalink.getPlayer(guild.id);
      if (!player) return void interaction.reply("Não estou em nenhum canal.");
      await player.destroy();
      await interaction.reply("Saí do canal.");
    } catch (err) {
      console.error("Erro ao sair:", err);
      try { await interaction.reply("Erro ao sair do canal."); } catch {}
    }
    return;
  }

  if (commandName === "queue") {
    try {
      const player = lavalink.getPlayer(guild.id);
      if (!player?.queue.current) return void interaction.reply("A fila está vazia.");

      const current = player.queue.current;
      const tracks = player.queue.tracks.slice(0, 10);

      let msg = `**Tocando agora:** ${current.info.title}\n`;
      if (tracks.length) {
        msg += "\n**Fila:**\n" + tracks.map((t, i) => `${i + 1}. ${t.info.title}`).join("\n");
        if (player.queue.tracks.length > 10) msg += `\n...e mais ${player.queue.tracks.length - 10}`;
      }

      await interaction.reply(msg);
    } catch (err) {
      console.error("Erro ao mostrar fila:", err);
      try { await interaction.reply("Erro ao mostrar a fila."); } catch {}
    }
    return;
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN não definido");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
