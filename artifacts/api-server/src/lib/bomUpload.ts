/**
 * Single entry point for parsing BOM upload files (.kss KISS exports and
 * .xml Tekla PowerFab exports) so the job and estimate import routes share
 * one pipeline.
 */
import path from "path";
import { parseKissFile, KissParseError, type ParsedBom } from "./kissParser";
import { parsePowerFabXml } from "./powerFabParser";

export const ALLOWED_BOM_EXTENSIONS = [".kss", ".xml"] as const;

export function bomUploadExtError(originalName: string): string | null {
  const ext = path.extname(originalName).toLowerCase();
  if ((ALLOWED_BOM_EXTENSIONS as readonly string[]).includes(ext)) return null;
  return `File type "${ext || "unknown"}" is not allowed. Upload a KISS (.kss) or Tekla PowerFab XML (.xml) file.`;
}

export function parseBomUpload(originalName: string, buffer: Buffer): ParsedBom {
  const ext = path.extname(originalName).toLowerCase();
  const content = buffer.toString("utf8");
  if (ext === ".xml") return parsePowerFabXml(content);
  if (ext === ".kss") return parseKissFile(content);
  throw new KissParseError(bomUploadExtError(originalName)!);
}
