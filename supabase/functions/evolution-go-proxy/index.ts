import { serveRetiredWhatsAppFunction } from "../_shared/retired.ts";

// All provider operations now belong to the Go backend. This canonical
// tombstone also denies historical browser and private-worker payloads.
serveRetiredWhatsAppFunction("evolution-go-proxy");
