import { parseYaml } from "obsidian";

import { codeFence } from "../constants";
import { headingRegExp } from "../regexp";
import {
  activitiesHeading,
  normalizeActivities,
} from "../service/list-props-parser";

import { propsSchema, type Props, toMarkdown } from "./props";

type Section = {
  startLine: number;
  endLine: number;
  headingLine?: number;
  headingLevel?: number;
};

type ExistingBlock = {
  startLine: number;
  endLine: number;
  indentation: string;
};

function findActivitiesSection(lines: string[]): Section {
  let headingIndex = -1;
  let level = 1;

  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = headingRegExp.exec(lines[i]);

    if (!headingMatch) {
      continue;
    }

    const [, tokens] = headingMatch;
    const headingText = lines[i].slice(tokens.length).trim().toLowerCase();

    if (headingText === activitiesHeading.toLowerCase()) {
      headingIndex = i;
      level = tokens.length;
      break;
    }
  }

  if (headingIndex === -1) {
    return {
      startLine: lines.length,
      endLine: lines.length,
    };
  }

  let endLine = lines.length;

  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const match = headingRegExp.exec(lines[i]);

    if (match && match[1].length <= level) {
      endLine = i;
      break;
    }
  }

  return {
    startLine: headingIndex + 1,
    endLine,
    headingLine: headingIndex,
    headingLevel: level,
  };
}

function findExistingBlock(
  lines: string[],
  section: Section,
): ExistingBlock | undefined {
  for (
    let lineIndex = section.startLine;
    lineIndex < section.endLine;
    lineIndex += 1
  ) {
    const line = lines[lineIndex];

    const trimmedLine = line.trimStart();

    if (!trimmedLine.startsWith(codeFence + "activities")) {
      continue;
    }

    const indentation = line.match(/^\s*/)?.[0] ?? "";
    let probeLine = lineIndex + 1;

    while (
      probeLine < section.endLine &&
      !lines[probeLine].trimStart().startsWith(codeFence)
    ) {
      probeLine += 1;
    }

    if (probeLine >= section.endLine) {
      return undefined;
    }

    return {
      startLine: lineIndex,
      endLine: probeLine,
      indentation,
    };
  }

  return undefined;
}

function parseExistingProps(
  lines: string[],
  existingBlock: ExistingBlock | undefined,
  filePath?: string,
): Props {
  if (!existingBlock) {
    return {};
  }

  const { startLine: blockStartLine, endLine: blockEndLine, indentation } =
    existingBlock;
  const linesInsideCodeBlock = lines.slice(blockStartLine + 1, blockEndLine);

  const trimmedTextInsideCodeBlock = linesInsideCodeBlock
    .map((line) =>
      indentation && line.startsWith(indentation)
        ? line.slice(indentation.length)
        : line,
    )
    .join("\n");

  try {
    const parsedYaml = parseYaml(trimmedTextInsideCodeBlock);
    const normalized = normalizeActivities(parsedYaml);

    return propsSchema.parse(normalized);
  } catch (error) {
    const startLine = blockStartLine + 1;
    const endLine = blockEndLine + 1;
    const source = filePath ?? "unknown file";
    console.error(
      `Failed to parse props schema in ${source} at lines ${startLine}-${endLine}.`,
    );
    console.error(error);

    return {};
  }
}

function createIndentedBlock(indentation: string, props: Props) {
  const asMarkdown = toMarkdown(props);
  const lines = asMarkdown.split("\n");

  if (!indentation) {
    return lines;
  }

  return lines.map((line) => indentation + line);
}

function ensureActivitiesHeading(lines: string[]) {
  const headingText =
    activitiesHeading.slice(0, 1).toUpperCase() + activitiesHeading.slice(1);
  if (lines.length === 0) {
    return [`# ${headingText}`, ""];
  }

  if (lines[lines.length - 1].trim().length > 0) {
    return [...lines, "", `# ${headingText}`, ""];
  }

  return [...lines, `# ${headingText}`, ""];
}

function insertBlock({
  lines,
  blockLines,
  insertAt,
}: {
  lines: string[];
  blockLines: string[];
  insertAt: number;
}) {
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);

  const needsEmptyLine =
    before.length > 0 && before[before.length - 1].trim().length > 0;

  const prefix = needsEmptyLine ? [""] : [];

  return before.concat(prefix, blockLines, after);
}

export function upsertActivitiesBlock(props: {
  fileText: string;
  updateFn: (props: Props) => Props;
  filePath?: string;
}) {
  const { fileText, updateFn, filePath } = props;

  const lines = fileText.split("\n");
  const section = findActivitiesSection(lines);

  const existingBlock = findExistingBlock(lines, section);
  const existingProps = parseExistingProps(lines, existingBlock, filePath);
  const updatedProps = updateFn(existingProps);
  const blockLines = createIndentedBlock(
    existingBlock?.indentation || "",
    updatedProps,
  );

  if (existingBlock) {
    const before = lines.slice(0, existingBlock.startLine);
    const after = lines.slice(existingBlock.endLine + 1);

    return before.concat(blockLines, after).join("\n");
  }

  if (section.headingLine === undefined) {
    const withHeading = ensureActivitiesHeading(lines);

    return insertBlock({
      lines: withHeading,
      blockLines,
      insertAt: withHeading.length,
    }).join("\n");
  }

  return insertBlock({
    lines,
    blockLines,
    insertAt: section.startLine,
  }).join("\n");
}
