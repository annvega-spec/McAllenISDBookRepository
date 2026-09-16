export type Formats = {
  book: boolean;
  ebook: boolean;
  audio: boolean;
};

export type Reviews = {
  booklist?: string[];
  kirkus?: string[];
  pw?: string[];
  slj?: string[];
  hornBook?: string[];
  commonSenseMedia?: string[];
  other?: string[];
};

export type TitleRecord = {
  id: string;
  title: string;
  titleUnknown?: boolean;
  authors: string[];
  isbns: string[];
  isbnDigits: string[];
  batches: string[];
  postedBatches?: string[];
  holdingsBatches?: string[];
  levels: string[];
  audiences: string[];
  editions?: string[];
  formats: Formats;
  posted?: boolean;
  inCollection?: boolean;
  possibleDuplicate: boolean;
  reviews: Reviews;
  rowCount: number;
};

export type CollectionData = {
  generatedAt: string;
  sourceFiles?: string[];
  sourceFile?: string;
  sheet: string;
  rowCount: number;
  uniqueTitleCount: number;
  batches: string[];
  levels: string[];
  holdingsFile?: string;
  holdingsBatch?: string;
  stats: {
    rowsByBatch: Record<string, number>;
    titlesByBatch: Record<string, number>;
    rowsByLevel: Record<string, number>;
    titlesByLevel: Record<string, number>;
    skippedDuplicateRows?: number;
    skippedExcludedRows?: number;
    postedTitleCount?: number;
    inCollectionPostedCount?: number;
    holdingsRows?: number;
    holdingsUniqueIsbns?: number;
    holdingsLinkedToPosted?: number;
    holdingsOnly?: number;
    holdingsOnlyIsbns?: number;
    holdingsTitledRows?: number;
  };
  titles: TitleRecord[];
};

export type ScoredTitle = {
  title: TitleRecord;
  score: number;
  reason: "isbn" | "title" | "author" | "fuzzy";
};

export type Presence = "both" | "posted" | "holdings";

export function isPosted(title: TitleRecord): boolean {
  return title.posted !== false;
}

export function isInCollection(title: TitleRecord): boolean {
  return title.inCollection === true;
}

export function presenceOf(title: TitleRecord): Presence {
  const posted = isPosted(title);
  const holdings = isInCollection(title);
  if (posted && holdings) return "both";
  if (holdings) return "holdings";
  return "posted";
}

export function displayTitle(title: TitleRecord): string {
  if (title.title) return title.title;
  return "Title not listed";
}
