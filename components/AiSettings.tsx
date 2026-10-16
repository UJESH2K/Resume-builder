"use client";

import { availableProviders, isBlockedLocalCall, type ProviderId } from "@/lib/ai/providers";
import { useEffect, useState } from "react";
import type { UseAiConfig } from "@/lib/ai/config";

/**
 * Provider / key / model form, shared by the role tailor and the importer so a student
 * pastes their key once and both features pick it up.
 */
export function AiSettings({ ai, idSuffix }: { ai: UseAiConfig; idSuffix: string }) {
  const { cfg, provider, set, switchProvider } = ai;
  const listId = `ai-models-${idSuffix}`;

  // Checked after mount: it depends on window.location, which does not exist while rendering
  // on the server, and a mismatch would break hydration.
  const [blockedLocally, setBlockedLocally] = useState(false);
  useEffect(() => {
    setBlockedLocally(isBlockedLocalCall(cfg.baseUrl, cfg.provider));
  }, [cfg.baseUrl, cfg.provider]);

  return (
    <>
      <p className="tailor-hint">
        {cfg.provider === "shared"
          ? "Nothing to set up — this uses a model provided by this site, shared with everyone, so there is an hourly limit."
          : "Your API key is used by your own browser and sent straight to the provider. It never reaches Resume Studio and we never store it."}
      </p>

      <label className="field">
        <span>Provider</span>
        <select value={cfg.provider} onChange={(e) => switchProvider(e.target.value as ProviderId)}>
          {availableProviders().map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.cost}
            </option>
          ))}
        </select>
      </label>

      <p className="tailor-hint">
        {provider.blurb}
        {provider.keyUrl && (
          <>
            {" "}
            <a href={provider.keyUrl} target="_blank" rel="noreferrer">
              {provider.needsKey ? "Get a free key" : "Install it"}
            </a>
          </>
        )}
      </p>

      {provider.needsKey && (
        <label className="field">
          <span>
            API key {provider.keyHint && <em>({provider.keyHint})</em>}
          </span>
          <input
            type="password"
            value={cfg.apiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key"
            onChange={(e) => set({ apiKey: e.target.value })}
          />
        </label>
      )}

      {cfg.provider === "ollama" && (
        <>
          <label className="field">
            <span>Ollama address</span>
            <input
              value={cfg.baseUrl}
              placeholder={provider.defaultBaseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </label>
          {blockedLocally && (
            <p className="notice warn-inline">
              <strong>Ollama will not work on this site.</strong> This page is served over https
              and Ollama runs on plain http on your own machine — browsers block that. Ollama
              works when you run Resume Studio locally. Here, pick Gemini or Groq (both free).
            </p>
          )}
          {!blockedLocally && (
            <p className="tailor-hint">
              Ollama must allow this page: start it with <code>OLLAMA_ORIGINS=*</code> set, and
              pull the model first (<code>ollama pull {cfg.model || "llama3.2"}</code>).
            </p>
          )}
        </>
      )}

      {cfg.provider !== "shared" && (
      <label className="field">
        <span>Model</span>
        <input
          value={cfg.model}
          list={listId}
          spellCheck={false}
          onChange={(e) => set({ model: e.target.value })}
        />
        <datalist id={listId}>
          {provider.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      )}

      {provider.needsKey && (
        <label className="check">
          <input type="checkbox" checked={cfg.remember} onChange={(e) => set({ remember: e.target.checked })} />
          <span>Remember the key on this device</span>
        </label>
      )}
    </>
  );
}
