import gamesData from "../games.json";

export type Game = {
  id: string;
  title: string;
  author: string;
  description: string;
  sourcePath: string;
  sourceSubpath?: string;
  sourceUrl: string;
  upstreamUrl: string;
  adapter: string;
  entry: string;
  cover: string | null;
  coverSource: string | null;
  catalogCoverSource?: string;
  notice: string;
  noticeSource: string;
  license: string;
  edition: string;
  input: string;
  session: string;
  category: string;
  group: string;
  language: string;
  featured: boolean;
  collectionNumber?: number;
};

export const games = gamesData as Game[];
