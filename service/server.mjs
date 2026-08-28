#!/usr/bin/env node
import { runConfiguredStaticService } from "@local-agent-bridge/node-sidecar-runtime";

export const serviceRuntime = runConfiguredStaticService(import.meta.url);
export const createServiceServer = serviceRuntime.createServer;
