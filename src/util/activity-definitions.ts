export type ActivityAttributeField = {
  key: string;
  label: string;
  type: "text" | "number" | "textarea";
  suggestHistory?: boolean;
  resourceTag?: string;
  required?: boolean;
  min?: number;
  max?: number;
};

export type ActivityAttributesDefinition = {
  key: string;
  mainKey?: string;
  start: ActivityAttributeField[];
  end: ActivityAttributeField[];
  ranges?: {
    key: string;
    start: string;
    end: string;
  }[];
};

export type ActivityPlanDefinition = {
  defaultHours: number;
  maxHours?: number;
  intervalMinutes?: number;
};

export type ActivityGroupDefinition = {
  name: string;
  label: string;
  color: string;
};

export type ActivityDefinition = {
  name: string;
  label: string;
  group: ActivityGroupDefinition["name"];
  emoji?: string;
  attributes?: ActivityAttributesDefinition;
  plan?: ActivityPlanDefinition;
};

export type ActivitySuggestion = Pick<
  ActivityDefinition,
  "name" | "label" | "emoji"
>;

const activityGroups: ActivityGroupDefinition[] = [
  { name: "work", label: "Work", color: "#808080" },
  { name: "media", label: "Media", color: "#00bcd4" },
  { name: "bed", label: "Bed", color: "#0000b9" },
  {
    name: "exercise",
    label: "Exercise",
    color: "#2e7d32",
  },
  { name: "hygiene", label: "Hygiene", color: "#ffd600" },
  { name: "household", label: "Household", color: "#8b4513" },
  { name: "social", label: "Social", color: "#8e24aa" },
  { name: "transit", label: "Transit", color: "#d32f2f" },
];

const activityDefinitions: ActivityDefinition[] = [
  {
    name: "read",
    label: "Read",
    group: "media",
    plan: { defaultHours: 5 },
    emoji: "📖",
    attributes: {
      key: "read",
      mainKey: "book",
      start: [
        {
          key: "book",
          label: "Book",
          type: "text",
          required: true,
          resourceTag: "book",
        },
        {
          key: "start-page",
          label: "Start page",
          type: "number",
          required: true,
          min: 1,
        },
      ],
      end: [
        {
          key: "end-page",
          label: "End page",
          type: "number",
          required: true,
          min: 1,
        },
      ],
      ranges: [
        {
          key: "pages",
          start: "start-page",
          end: "end-page",
        },
      ],
    },
  },
  {
    name: "game",
    label: "Game",
    group: "media",
    plan: { defaultHours: 15 },
    emoji: "🎮",
    attributes: {
      key: "game",
      mainKey: "name",
      start: [{ key: "name", label: "Game", type: "text", required: true, resourceTag: "game" }],
      end: [],
    },
  },
  {
    name: "movie",
    label: "Movie",
    group: "media",
    emoji: "📺",
    attributes: {
      key: "movie",
      mainKey: "name",
      start: [
        {
          key: "name",
          label: "Movie",
          type: "text",
          required: true,
          suggestHistory: false,
        },
      ],
      end: [],
    },
  },
  {
    name: "tv",
    label: "TV",
    group: "media",
    emoji: "📺",
    attributes: {
      key: "tv",
      mainKey: "name",
      start: [
        { key: "name", label: "Show", type: "text", required: true },
        { key: "episodes", label: "Episodes", type: "text", required: true },
      ],
      end: [],
    },
  },
  {
    name: "theater",
    label: "Theater",
    group: "media",
    emoji: "📽️",
    attributes: {
      key: "theater",
      mainKey: "name",
      start: [
        {
          key: "name",
          label: "Movie",
          type: "text",
          required: true,
          suggestHistory: false,
        },
      ],
      end: [],
    },
  },
  {
    name: "call",
    label: "Call",
    group: "social",
    emoji: "📞",
    attributes: {
      key: "call",
      mainKey: "with",
      start: [{ key: "with", label: "With", type: "text", required: true }],
      end: [],
    },
  },
  {
    name: "light work",
    label: "Light Work",
    group: "work",
    plan: { defaultHours: 30 },
    emoji: "🔧",
    attributes: {
      key: "light work",
      mainKey: "project",
      start: [
        {
          key: "project",
          label: "Project",
          type: "text",
          required: true,
        },
      ],
      end: [],
    },
  },
  {
    name: "deep work",
    label: "Deep Work",
    group: "work",
    plan: { defaultHours: 10 },
    emoji: "🛠️",
    attributes: {
      key: "deep work",
      mainKey: "project",
      start: [
        {
          key: "project",
          label: "Project",
          type: "text",
          required: true,
        },
      ],
      end: [],
    },
  },
  {
    name: "piano",
    label: "Piano",
    group: "media",
    emoji: "🎹",
  },
  {
    name: "walk",
    label: "Walk",
    group: "exercise",
    emoji: "🚶",
    plan: { defaultHours: 3, intervalMinutes: 30 },
  },
  {
    name: "juggle",
    label: "Juggle",
    group: "exercise",
    emoji: "🤹",
    plan: { defaultHours: 3, intervalMinutes: 15 },
  },
  {
    name: "exercise",
    label: "Exercise",
    group: "exercise",
    emoji: "🏋️",
    plan: { defaultHours: 2, intervalMinutes: 30 },
  },
  {
    name: "stretch",
    label: "Stretch",
    group: "exercise",
    emoji: "🧘",
    plan: { defaultHours: 2, intervalMinutes: 15 },
  },
  {
    name: "language",
    label: "Language",
    group: "work",
    emoji: "🗣️",
    plan: { defaultHours: 3, intervalMinutes: 30 },
  },
  {
    name: "housework",
    label: "Housework",
    group: "household",
    emoji: "🧹",
    plan: { defaultHours: 5, intervalMinutes: 30 },
  },
  {
    name: "cook",
    label: "Cook",
    group: "household",
    emoji: "🍳",
    plan: { defaultHours: 5, intervalMinutes: 30 },
  },
  { name: "eat", label: "Eat", group: "household", emoji: "🍽️" },
  {
    name: "hygiene",
    label: "Hygiene",
    group: "hygiene",
    emoji: "🪥",
    plan: { defaultHours: 2, intervalMinutes: 15 },
  },
  { name: "restaurant", label: "Restaurant", group: "social", emoji: "🍜" },
  { name: "bar", label: "Bar", group: "social", emoji: "🍸" },
  { name: "social", label: "Social", group: "social", emoji: "👯" },
  {
    name: "bed",
    label: "Bed",
    group: "bed",
    emoji: "🛏️",
    plan: { defaultHours: 56, maxHours: 70 },
  },
  { name: "ride", label: "Ride", group: "transit", emoji: "🚗" },
  {
    name: "transit",
    label: "Transit",
    group: "transit",
    emoji: "🚃",
  },
  { name: "shop", label: "Shop", group: "household", emoji: "🛍️" },
  {
    name: "pathfinder",
    label: "Pathfinder",
    group: "social",
    emoji: "🪄",
  },
];

export function getActivityGroups(): ActivityGroupDefinition[] {
  return activityGroups;
}

export function getActivityDefinitions(): ActivityDefinition[] {
  return activityDefinitions;
}

const activityGroupMap = new Map(
  activityGroups.map((group) => [group.name, group]),
);

const activityDefinitionMap = new Map(
  activityDefinitions.map((definition) => [
    normalizeActivityName(definition.name),
    definition,
  ]),
);

export function normalizeActivityName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function sanitizeLabel(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function getActivityDefinition(activityName: string) {
  return activityDefinitionMap.get(normalizeActivityName(activityName));
}

export function getActivityGroup(activityName: string) {
  const definition = getActivityDefinition(activityName);

  return definition ? activityGroupMap.get(definition.group) : undefined;
}

export function getActivitySuggestions(): ActivitySuggestion[] {
  return activityDefinitions.map(({ name, label, emoji }) => ({
    name,
    label,
    emoji,
  }));
}

export function getActivityLabel(activityName: string) {
  const definition = getActivityDefinition(activityName);
  const label = definition?.label ?? sanitizeLabel(activityName);

  if (!definition?.emoji) {
    return label;
  }

  return `${definition.emoji} ${label}`;
}

export function getActivityDisplayLabel(
  activityName: string,
  activityEntry?: Record<string, unknown>,
) {
  const baseLabel = getActivityLabel(activityName);
  const definition = getActivityDefinition(activityName);
  const attributes = definition?.attributes;

  if (!attributes?.mainKey || !activityEntry) {
    return baseLabel;
  }

  const values = getActivityAttributeValues(activityName, activityEntry);
  const mainValue = values[attributes.mainKey];

  if (typeof mainValue !== "string" || mainValue.trim().length === 0) {
    return baseLabel;
  }

  return `${baseLabel} - ${mainValue.trim()}`;
}

export function getActivityAttributeFields(
  activityName: string,
  stage: "start" | "end",
) {
  const definition = getActivityDefinition(activityName);

  return definition?.attributes?.[stage] ?? [];
}

export function buildActivityAttributeUpdate(
  activityName: string,
  values: Record<string, string | number | undefined>,
) {
  const definition = getActivityDefinition(activityName);

  if (!definition?.attributes) {
    return {};
  }

  const attributeValues = Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value !== "undefined"),
  );

  if (Object.keys(attributeValues).length === 0) {
    return {};
  }

  return {
    [definition.attributes.key]: attributeValues,
  };
}

export function getActivityAttributeValues(
  activityName: string,
  activityEntry?: Record<string, unknown>,
) {
  const definition = getActivityDefinition(activityName);

  if (!definition?.attributes || !activityEntry) {
    return {};
  }

  const details = activityEntry[definition.attributes.key];

  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }

  return details as Record<string, string | number | undefined>;
}

export const qualityRatingField: ActivityAttributeField = {
  key: "quality",
  label: "Quality (1-10)",
  type: "number",
  min: 1,
  max: 10,
};

export const activityNotesField: ActivityAttributeField = {
  key: "notes",
  label: "Notes",
  type: "textarea",
};
