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
  posted?: boolean;
  owned?: boolean;
  ebookOrder?: boolean;
  formatNotes?: string[];
  ownedSources?: string[];
  reviews: Reviews;
  rowCount: number;
};

export type OwnedCatalog = {
  source: string;
  sources?: string[];
  sourceFiles?: string[];
  count: number;
  isbn13: string;
  authors: string[];
  titles: string[];
  a: string;
  t: string;
  f: string;
  stats?: {
    sourceRows?: number;
    acceptedRows?: number;
    uniqueIsbn13?: number;
    skippedNonBook?: number;
    skippedNoIsbn?: number;
    duplicateIsbnRows?: number;
  };
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
  owned?: {
    source?: string;
    sources?: string[];
    count?: number;
    file?: string;
    stats?: OwnedCatalog["stats"];
  };
  stats: {
    rowsByBatch: Record<string, number>;
    titlesByBatch: Record<string, number>;
    rowsByLevel: Record<string, number>;
    titlesByLevel: Record<string, number>;
    skippedDuplicateRows?: number;
    ownedIsbnCount?: number;
    postedTitleCount?: number;
    ebookOrderTitleCount?: number;
    ownedNamedTitleCount?: number;
    ownedAndPostedTitleCount?: number;
  };
  titles: TitleRecord[];
};

export type ScoredTitle = {
  title: TitleRecord;
  score: number;
  reason: "isbn" | "title" | "author" | "fuzzy" | "owned";
};

export type SourceFilter = "all" | "posted" | "owned" | "ebook-order";
