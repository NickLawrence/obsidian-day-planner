import {
  type CachedMetadata,
  type MetadataCache,
  parseYaml,
  type Vault,
} from "obsidian";

import { codeFence } from "../constants";
import type { LineToListProps } from "../redux/dataview/dataview-slice";
import { type LogEntry, type Props, propsSchema } from "../util/props";

export class ListPropsParser {
  private static readonly activitiesHeading = "activities";

  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
  ) {}

  async parse(path: string) {
    const file = this.vault.getFileByPath(path);

    if (!file) {
      return;
    }

    const metadata = this.metadataCache.getFileCache(file);

    if (!metadata) {
      return;
    }

    const contents = await this.vault.cachedRead(file);

    return this.getActivitiesProps(contents, metadata);
  }

  private getActivitiesProps(
    fileText: string,
    metadata: CachedMetadata,
  ): LineToListProps {
    const headings = metadata.headings;

    if (!headings?.length) {
      return {};
    }

    const targetHeadings = headings.filter(
      (heading) =>
        heading.heading.trim().toLowerCase() ===
        ListPropsParser.activitiesHeading.toLowerCase(),
    );

    if (targetHeadings.length === 0) {
      return {};
    }

    const allLines = fileText.split("\n");
    const lineOffsets = this.getLineOffsets(allLines);

    const result: LineToListProps = {};

    targetHeadings.forEach((heading) => {
      const headingIndex = headings.indexOf(heading);
      const sectionStartLine = heading.position.start.line + 1;
      const sectionEndLine =
        headings[headingIndex + 1]?.position.start.line ?? allLines.length;

      let currentLine = sectionStartLine;

      while (currentLine < sectionEndLine) {
        const currentLineText = allLines[currentLine];

        if (!currentLineText?.trimStart().startsWith(codeFence + "activities")) {
          currentLine += 1;
          continue;
        }

        const indentation = currentLineText.match(/^\s*/)?.[0] ?? "";
        const contentStartLine = currentLine + 1;
        let probeLine = contentStartLine;

        while (
          probeLine < sectionEndLine &&
          !allLines[probeLine].trimStart().startsWith(codeFence)
        ) {
          probeLine += 1;
        }

        if (probeLine >= sectionEndLine) {
          break;
        }

        const closingLine = probeLine;
        const linesInsideCodeBlock = allLines.slice(
          contentStartLine,
          closingLine,
        );

        const trimmedTextInsideCodeBlock = linesInsideCodeBlock
          .map((line) =>
            indentation && line.startsWith(indentation)
              ? line.slice(indentation.length)
              : line,
          )
          .join("\n");

        let validated: Props;

        try {
          const parsedYaml = parseYaml(trimmedTextInsideCodeBlock);
          const normalized = this.normalizeActivities(parsedYaml);
          validated = propsSchema.parse(normalized);
        } catch (error) {
          console.error(error);
          currentLine = closingLine + 1;
          continue;
        }

        result[currentLine] = {
          parsed: validated,
          position: {
            start: {
              line: currentLine,
              col: 0,
              offset: lineOffsets[currentLine],
            },
            end: {
              line: closingLine,
              col: allLines[closingLine]?.length ?? 0,
              offset:
                lineOffsets[closingLine] +
                (allLines[closingLine]?.length ?? 0),
            },
          },
        };

        currentLine = closingLine + 1;
      }
    });

    return result;
  }

  private getLineOffsets(lines: string[]) {
    const offsets: number[] = [0];

    for (let i = 0; i < lines.length; i += 1) {
      offsets.push(offsets[i] + lines[i].length + 1);
    }

    return offsets;
  }

  private normalizeActivities(parsedYaml: unknown): Props {
    const normalized: Props = Array.isArray(parsedYaml)
      ? {
          planner: {
            activities: parsedYaml as NonNullable<Props["planner"]>["activities"],
          },
        }
      : ((parsedYaml ?? {}) as Props);

    const activities = normalized.planner?.activities;

    if (Array.isArray(activities)) {
      const aggregatedLogs =
        activities
          .flatMap((item) => item?.log || [])
          .filter(Boolean) as LogEntry[];

      if (aggregatedLogs.length > 0) {
        normalized.planner = {
          ...normalized.planner,
          log: aggregatedLogs,
        };
      }
    }

    return normalized;
  }
}
