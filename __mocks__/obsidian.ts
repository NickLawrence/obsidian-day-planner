import path from "node:path";
import { dump } from "js-yaml";
import { vi } from "vitest"

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TFile = vi.fn();
export const normalizePath = (p: string) => path.normalize(p);
export const stringifyYaml = dump;
