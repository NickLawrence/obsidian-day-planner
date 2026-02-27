export type ActivityAttributeField = {
  key: string;
  label: string;
  type: "text" | "number" | "textarea";
  required?: boolean;
  min?: number;
  max?: number;
};

export type ActivityAttributesDefinition = {
  key: string;
  mainKey?: string;
  start: ActivityAttributeField[];
  end: ActivityAttributeField[];
};

export type ActivityDefinition = {
  name: string;
  label: string;
  emoji?: string;
  attributes?: ActivityAttributesDefinition;
};

export type ActivitySuggestion = Pick<ActivityDefinition, "name" | "label" | "emoji">;

const activityDefinitions: ActivityDefinition[] = [
  {
    name: "read",
    label: "Read",
    emoji: "📖",
    attributes: {
      key: "read",
      mainKey: "book",
      start: [
        { key: "book", label: "Book", type: "text", required: true },
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
    },
  },
  {
    name: "game",
    label: "Game",
    emoji: "🎮",
    attributes: {
      key: "game",
      start: [{ key: "name", label: "Game", type: "text", required: true }],
      end: [],
    },
  },
  {
    name: "movie",
    label: "Movie",
    emoji: "📺",
    attributes: {
      key: "movie",
      start: [{ key: "name", label: "Movie", type: "text", required: true }],
      end: [],
    },
  },
  {
    name: "tv",
    label: "TV",
    emoji: "📺",
    attributes: {
      key: "tv",
      start: [
        { key: "name", label: "Show", type: "text", required: true },
        { key: "episodes", label: "Episodes", type: "text", required: true }
      ],
      end: [],
    },
  },
  {
    name: "call",
    label: "Call",
    emoji: "📞",
    attributes: {
      key: "call",
      start: [{ key: "with", label: "With", type: "text", required: true }],
      end: [],
    },
  },
  {
    name: "light work",
    label: "Light Work",
    emoji: "🔧",
    attributes: {
      key: "deep work",
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
    emoji: "🛠️",
    attributes: {
      key: "deep work",
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
  { name: "piano", label: "Piano", emoji: "🎹" },
  { name: "walk", label: "Walk", emoji: "🚶" },
  { name: "juggle", label: "Juggle", emoji: "🤹" },
  { name: "exercise", label: "Exercise", emoji: "🏋️" },
  { name: "stretch", label: "Stretch", emoji: "🧘" },
  { name: "language", label: "Language", emoji: "🗣️" },
  { name: "housework", label: "Housework", emoji: "🧹" },
  { name: "cook", label: "Cook", emoji: "🍳" },
  { name: "eat", label: "Eat", emoji: "🍽️" },
  { name: "hygiene", label: "Hygiene", emoji: "🪥" },
  { name: "bed", label: "Bed", emoji: "🛏️" },
  { name: "ride", label: "Ride", emoji: "🚗" },
  { name: "transit", label: "Transit", emoji: "🚃" },
  { name: "shop", label: "Shop", emoji: "🛍️" },
  { name: "pathfinder", label: "Pathfinder", emoji: "🪄" }
];

export function getActivityDefinitions(): ActivityDefinition[] {
  return activityDefinitions;
}

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
