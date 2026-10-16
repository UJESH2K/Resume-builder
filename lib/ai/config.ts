"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDERS, providerById, type Provider, type ProviderId } from "./providers";

/**
 * The student's AI settings, shared by every feature that needs a model (the role tailor and
 * the "paste about yourself" importer) so a key is pasted once, not once per screen.
 *
 * Lives in localStorage on their own device. The key is only kept when they tick "remember";
 * otherwise it stays in memory for the tab. It is never sent to the Resume Studio server —
 * see lib/ai/providers.ts.
 */

const LS_AI = "resume-studio:ai";

export interface AiConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  remember: boolean;
}

export const AI_DEFAULTS: AiConfig = {
  provider: "gemini",
  model: PROVIDERS[0].models[0],
  apiKey: "",
  baseUrl: "",
  remember: true,
};

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(LS_AI);
    if (!raw) return AI_DEFAULTS;
    return { ...AI_DEFAULTS, ...(JSON.parse(raw) as Partial<AiConfig>) };
  } catch {
    return AI_DEFAULTS;
  }
}

export function saveAiConfig(next: AiConfig): void {
  try {
    const { apiKey: _drop, ...withoutKey } = next;
    localStorage.setItem(LS_AI, JSON.stringify(next.remember ? next : withoutKey));
  } catch {
    // private window or blocked storage — the settings just will not persist
  }
}

export interface UseAiConfig {
  cfg: AiConfig;
  provider: Provider;
  /** Merge a change and persist it. */
  set: (patch: Partial<AiConfig>) => void;
  /** Switch provider, resetting model and base URL to that provider's defaults. */
  switchProvider: (id: ProviderId) => void;
  /** True when this provider is ready to be called. */
  ready: boolean;
}

export function useAiConfig(): UseAiConfig {
  const [cfg, setCfg] = useState<AiConfig>(AI_DEFAULTS);

  // Read on mount, not during render: localStorage does not exist on the server.
  useEffect(() => setCfg(loadAiConfig()), []);

  const set = useCallback((patch: Partial<AiConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveAiConfig(next);
      return next;
    });
  }, []);

  const switchProvider = useCallback((id: ProviderId) => {
    const p = providerById(id)!;
    setCfg((prev) => {
      const next = { ...prev, provider: id, model: p.models[0], baseUrl: p.defaultBaseUrl ?? "" };
      saveAiConfig(next);
      return next;
    });
  }, []);

  const provider = providerById(cfg.provider) ?? PROVIDERS[0];
  const ready = !provider.needsKey || cfg.apiKey.trim().length > 0;

  return { cfg, provider, set, switchProvider, ready };
}
