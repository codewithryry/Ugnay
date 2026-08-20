"use client";

import { useEffect, useState } from "react";
import { FileText, FolderClosed, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";

const inputClass =
  "w-full rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm";

/**
 * The workspace panel: opened from a workspace's "…" menu and rendered beside
 * the conversation, not in the sidebar. Holds the workspace's settings and the
 * instructions its conversations are answered with; both persist on the project
 * row through the store.
 */
export default function WorkspacePanel() {
  const panelProjectId = useChatStore((s) => s.panelProjectId);
  const setPanelProject = useChatStore((s) => s.setPanelProject);
  const project = useChatStore((s) => s.projects.find((p) => p.id === s.panelProjectId) ?? null);
  const saveProject = useChatStore((s) => s.saveProject);

  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  // Switching workspaces (or reopening one) shows its saved values.
  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setInstructions(project.instructions ?? "");
  }, [project?.id, project?.name, project?.instructions]);

  if (!panelProjectId || !project) return null;

  const dirty = name.trim() !== project.name || instructions !== (project.instructions ?? "");

  async function save() {
    if (saving) return;
    setSaving(true);
    await saveProject(project!.id, { name, instructions });
    setSaving(false);
  }

  return (
    <aside
      aria-label="Workspace panel"
      // Full screen on a phone, a column beside the conversation from md up.
      className="fixed inset-0 z-40 flex flex-col overflow-hidden border-ink-800 bg-ink-900 pb-safe pt-safe md:static md:z-auto md:w-[22rem] md:shrink-0 md:border-l md:p-0 lg:w-[24rem]"
    >
      <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
        <FolderClosed className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-100">
          {project.name}
        </h2>
        <button
          type="button"
          onClick={() => setPanelProject(null)}
          aria-label="Close workspace panel"
          className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4">
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-400">
            <FileText className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
            Instructions
          </h3>
          <textarea
            id="workspace-instructions"
            rows={10}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={`Add instructions for Ugnay in this workspace…`}
            className={cn(inputClass, "resize-y")}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
            Sent with every conversation in this workspace, alongside your global instructions.
          </p>
        </section>

        <section className="border-t border-ink-800 pt-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-400">
            <SlidersHorizontal className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
            Settings
          </h3>
          <label
            htmlFor="workspace-name"
            className="mb-1.5 block text-[11px] font-medium text-neutral-500"
          >
            Name
          </label>
          <input
            id="workspace-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </section>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-ink-800 px-4 py-3">
        <button
          type="button"
          onClick={() => setPanelProject(null)}
          className="rounded-xl border border-ink-700 px-3 py-2 text-xs text-neutral-300 transition hover:bg-ink-850 hover:text-neutral-100"
        >
          Close
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !name.trim() || !dirty}
          className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium text-ink-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </aside>
  );
}
