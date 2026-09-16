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
  authors: string[];
  isbns: string[];
  isbnDigits: string[];
  batches: string[];
  levels: string[];
  audiences: string[];
  formats: Formats;
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
  stats: {
    rowsByBatch: Record<string, number>;
    titlesByBatch: Record<string, number>;
    rowsByLevel: Record<string, number>;
    titlesByLevel: Record<string, number>;
    skippedDuplicateRows?: number;
  };
  titles: TitleRecord[];
};

export type ScoredTitle = {
  title: TitleRecord;
  score: number;
  reason: "isbn" | "title" | "author" | "fuzzy";
};
