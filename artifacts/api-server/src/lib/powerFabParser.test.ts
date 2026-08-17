/**
 * Tests the Tekla PowerFab XML parser against the real sample export the
 * detailers sent (attached_assets/0_SUBMITTAL_51_XML_*.xml, ~3.7 MB).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parsePowerFabXml } from "./powerFabParser";
import { KissParseError } from "./kissParser";
import { parseBomUpload, bomUploadExtError } from "./bomUpload";

const samplePath = resolve(
  __dirname,
  "../../../../attached_assets/0_SUBMITTAL_51_XML_1786975904583.xml",
);

describe("parsePowerFabXml (real sample file)", () => {
  const content = readFileSync(samplePath, "utf8");
  const parsed = parsePowerFabXml(content);

  it("extracts project header", () => {
    expect(parsed.jobRef).toBe("466");
    expect(parsed.jobName).toBe("Gilbert WTP GMP4");
  });

  it("extracts assemblies with parts and sensible fields", () => {
    expect(parsed.assemblies.length).toBeGreaterThan(0);
    const gr = parsed.assemblies.find((a) => a.mark === "8002GR");
    expect(gr).toBeTruthy();
    expect(gr!.quantity).toBe(1);
    expect(gr!.description).toBe("GUARDRAIL");
    expect(gr!.parts.length).toBeGreaterThanOrEqual(3);

    const main = gr!.parts.find((p) => p.partMark === "8002GR");
    expect(main).toBeTruthy();
    expect(main!.profileType).toBe("PI");
    expect(main!.profileSize).toBe("PI1-1/2STD");
    expect(main!.grade).toBe("6061-T6");
    expect(main!.lengthIn).toBeCloseTo(118.69, 1);
    // main member finish propagates to assembly
    expect(gr!.finish).toBe("ANODIZED");
  });

  it("every assembly has a mark and positive quantity", () => {
    for (const a of parsed.assemblies) {
      expect(a.mark.length).toBeGreaterThan(0);
      expect(a.quantity).toBeGreaterThanOrEqual(1);
      for (const p of a.parts) expect(p.quantity).toBeGreaterThanOrEqual(1);
    }
  });

  it("rejects non-PowerFab XML", () => {
    expect(() => parsePowerFabXml("<foo/>")).toThrow(KissParseError);
    expect(() => parsePowerFabXml("not xml at all")).toThrow(KissParseError);
  });
});

describe("parseBomUpload dispatch", () => {
  it("routes .xml to the PowerFab parser", () => {
    const buf = readFileSync(samplePath);
    const parsed = parseBomUpload("sample.XML", buf);
    expect(parsed.jobRef).toBe("466");
  });

  it("accepts .kss and .xml, rejects others", () => {
    expect(bomUploadExtError("a.kss")).toBeNull();
    expect(bomUploadExtError("a.xml")).toBeNull();
    expect(bomUploadExtError("a.csv")).toMatch(/not allowed/);
    expect(bomUploadExtError("noext")).toMatch(/not allowed/);
  });
});
