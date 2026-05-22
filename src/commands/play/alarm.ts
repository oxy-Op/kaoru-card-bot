import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  getAlarmPrefs,
  setAlarmPref,
  setAllAlarmPrefs,
  checkAndScheduleAlarms,
  type CooldownType,
} from "../../services/alarm.service.js";

const TYPE_CHOICES = [
  { name: "Summon", value: "summon" },
  { name: "Grab", value: "grab" },
  { name: "Daily", value: "daily" },
  { name: "Vote", value: "vote" },
  { name: "Minigame", value: "minigame" },
] as const;

const TYPE_LABELS: Record<CooldownType, string> = {
  summon: "Summon",
  grab: "Grab",
  daily: "Daily",
  vote: "Vote",
  minigame: "Minigame",
};

const ALL_TYPES: CooldownType[] = [
  "summon",
  "grab",
  "daily",
  "vote",
  "minigame",
];

export const data = new SlashCommandBuilder()
  .setName("alarm")
  .setDescription("DM reminders when your cooldowns expire")
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("View your alarm settings")
  )
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Enable alarm for a cooldown")
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Cooldown type")
          .setRequired(true)
          .addChoices(...TYPE_CHOICES)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("off")
      .setDescription("Disable alarm for a cooldown")
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Cooldown type")
          .setRequired(true)
          .addChoices(...TYPE_CHOICES)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("all").setDescription("Enable alarms for all cooldowns")
  )
  .addSubcommand((sub) =>
    sub.setName("clear").setDescription("Disable all alarms")
  );

function formatStatus(prefs: CooldownType[]): string {
  const set = new Set(prefs);
  return ALL_TYPES.map(
    (t) => `**${TYPE_LABELS[t]}** · ${set.has(t) ? "ON" : "OFF"}`
  ).join("\n");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand(true);

  if (sub === "show") {
    const prefs = await getAlarmPrefs(userId);
    await interaction.reply({
      content: `Cooldown DM alarms:\n${formatStatus(prefs)}`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "set") {
    const type = interaction.options.getString("type", true) as CooldownType;
    await setAlarmPref(userId, type, true);
    await checkAndScheduleAlarms(interaction.client, userId);
    await interaction.reply({
      content: `Alarm for **${TYPE_LABELS[type]}** is now **ON**. You'll get a DM when it's ready (if DMs are open).`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "off") {
    const type = interaction.options.getString("type", true) as CooldownType;
    await setAlarmPref(userId, type, false);
    await interaction.reply({
      content: `Alarm for **${TYPE_LABELS[type]}** is now **OFF**.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "all") {
    await setAllAlarmPrefs(userId, true);
    await checkAndScheduleAlarms(interaction.client, userId);
    await interaction.reply({
      content:
        "Alarms for **all** cooldown types are now **ON**. You'll get DMs when each is ready.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "clear") {
    await setAllAlarmPrefs(userId, false);
    await interaction.reply({
      content: "All cooldown alarms are **OFF**.",
      ephemeral: true,
    });
    return;
  }
}
