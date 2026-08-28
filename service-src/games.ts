import gamesData from "../games.json";

export type Game = {
  id: string;
  title: string;
  author: string;
  description: string;
  sourcePath: string;
  sourceUrl: string;
  upstreamUrl: string;
  adapter: string;
  entry: string;
  cover: string | null;
  license: string;
  edition: string;
  input: string;
  session: string;
};

export const games = gamesData as Game[];
