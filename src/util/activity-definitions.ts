export type ActivityAttributeField = {
  key: string;
  label: string;
  type: "text" | "number";
  required?: boolean;
  min?: number;
  max?: number;
};

export type ActivityAttributesDefinition = {
  key: string;
  start: ActivityAttributeField[];
  end: ActivityAttributeField[];
};

export type ActivityDefinition = {
  name: string;
  label: string;
  emoji?: string;
  attributes?: ActivityAttributesDefinition;
};

const activityDefinitions: ActivityDefinition[] = [
  {
    name: "read",
    label: "Read",
    emoji: "📖",
    attributes: {
      key: "read",
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
    name: "deep work",
    label: "Deep work",
    emoji: "🧠",
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
  { name: "hygiene", label: "Hygiene", emoji: "🪥" },
];

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

export function getActivityLabel(activityName: string) {
  const definition = getActivityDefinition(activityName);
  const label = definition?.label ?? sanitizeLabel(activityName);

  if (!definition?.emoji) {
    return label;
  }

  return `${definition.emoji} ${label}`;
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
