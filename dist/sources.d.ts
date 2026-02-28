import { Source, SourceTexts } from "./types";
export declare function collectSourceTexts(
  requestedSources: Source[],
): SourceTexts;
export declare function sourceTextsToArray(texts: SourceTexts): string[];
