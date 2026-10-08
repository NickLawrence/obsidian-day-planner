import {
  type CachedMetadata,
  type MetadataCache,
  parseYaml,
  type Vault,
} from "obsidian";

import { codeFence } from "../constants";
import type { LineToListProps } from "../redux/dataview/dataview-slice";
import { normalizeActivities } from "../util/activity-schema";
import { type ParsedProps, propsSchema } from "../util/props";

export { normalizeActivities } from "../util/activity-schema";

export class ListPropsParser {
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

    return this.getActivitiesProps(contents, metadata, path);
  }

  private getActivitiesProps(
    fileText: string,
    metadata: CachedMetadata,
    filePath: string,
  ): LineToListProps {
    const headings = metadata.headings ?? [];

    const targetHeadings = headings.filter(
      (heading) =>
        heading.heading.trim().toLowerCase() ===
        activitiesHeading.toLowerCase(),
    );

    const allLines = fileText.split("\n");
    const lineOffsets = this.getLineOffsets(allLines);
    const result: LineToListProps = {};

    const sections =
      targetHeadings.length > 0
        ? targetHeadings.map((heading) => {
            const headingIndex = headings.indexOf(heading);

            return {
              start: heading.position.start.line + 1,
              end:
                headings[headingIndex + 1]?.position.start.line ??
                allLines.length,
            };
          })
        : [{ start: 0, end: allLines.length }];

    sections.forEach((section) => {
      const sectionStartLine = section.start;
      const sectionEndLine = section.end;

      let currentLine = sectionStartLine;

      while (currentLine < sectionEndLine) {
        const currentLineText = allLines[currentLine];

        const trimmedLine = currentLineText?.trimStart() ?? "";

        if (!trimmedLine.startsWith(codeFence + "activities")) {
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

        let validated: ParsedProps;

        try {
          const parsedYaml = parseYaml(trimmedTextInsideCodeBlock);
          const normalized = normalizeActivities(parsedYaml);
          validated = propsSchema.parse(normalized);
        } catch (error) {
          const startLine = contentStartLine + 1;
          const endLine = closingLine + 1;
          console.error(
            `Failed to parse props schema in ${filePath} at lines ${startLine}-${endLine}.`,
          );
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
                lineOffsets[closingLine] + (allLines[closingLine]?.length ?? 0),
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
}

export const activitiesHeading = "activities";
