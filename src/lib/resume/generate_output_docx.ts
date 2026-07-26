// UI-facing wrapper tying in-place editing and the existing safe
// regeneration path together. This is the ONE place that decides which
// output a user actually gets - callers should never call
// tryGenerateInPlaceDocx or generateTailoredDocx directly.
import type { ResumeDocument } from "./models.ts";
import type { TailoredResume } from "./rewriter_base.ts";
import { generateTailoredDocx } from "./docx_writer.ts";
import { tryGenerateInPlaceDocx } from "./docx_inplace.ts";

export type GenerationMethod = "in_place" | "regenerated";

export interface GeneratedDocxResult {
  blob: Blob;
  fileName: string;
  method: GenerationMethod;
  // Only present when method is "regenerated" AND an in-place attempt was
  // actually made and declined (never present for PDF sources, which were
  // never eligible for in-place editing in the first place).
  fallbackReason?: string;
}

export async function generateOutputDocx(
  resume: ResumeDocument,
  tailored: TailoredResume,
  originalDocxBytes: ArrayBuffer | null,
  fileName: string,
): Promise<GeneratedDocxResult> {
  if (resume.sourceFormat === "docx" && originalDocxBytes) {
    const inPlace = await tryGenerateInPlaceDocx(originalDocxBytes, resume, tailored);
    if (inPlace.blob) {
      return { blob: inPlace.blob, fileName, method: "in_place" };
    }
    const blob = await generateTailoredDocx(resume, tailored);
    return { blob, fileName, method: "regenerated", fallbackReason: inPlace.reason };
  }
  const blob = await generateTailoredDocx(resume, tailored);
  return { blob, fileName, method: "regenerated" };
}
