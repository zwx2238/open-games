import gamesData from "../games.json";

export type Game = {
  id: string;
  title: string;
  author: string;
  description: string;
  sourceId: string;
  sourceTitle: string;
  sourcePath: string;
  sourceSubpath?: string;
  sourceEntry?: string;
  sourceUrl: string;
  upstreamUrl: string;
  adapter: string;
  entry: string;
  cover: string;
  coverSource: string | null;
  catalogCoverSource?: string;
  notices: Array<{ target: string; source: string }>;
  license: string;
  edition: string;
  input: string;
  inputs: string[];
  devices: string[];
  session: string;
  category: string;
  group: string;
  language: string;
  quality: string;
  editorialTier: "showcase" | "curated" | "catalog" | "degraded" | "archived";
  status: string;
  runtime: "offline" | "network" | "hybrid";
  runtimeNote: string;
  creationMethod: "vibe-coded" | "ai-assisted" | "not-disclosed";
  creationNote: string;
  performance: "standard" | "high";
  tags: string[];
  contentTags: string[];
  technology: string;
  featured: boolean;
  collectionNumber?: number;
  runtimeFiles?: string[];
  runtimeDirectories?: string[];
  runtimeExclude?: string[];
  packageManager?: "npm" | "pnpm" | "bun" | "yarn";
  packageSubpath?: string;
  serviceEntry?: "server.js" | "server.mjs" | "server.cjs";
  serviceRuntimeFiles?: string[];
  serviceRuntimeDirectories?: string[];
  serviceStaticRoot?: "public";
  buildOutput?:
    | ".app"
    | "build"
    | "client/dist"
    | "deploy"
    | "dist"
    | "dist/client"
    | "docs"
    | "out"
    | "packages/game/dist"
    | "public";
};

export const games = gamesData as Game[];
