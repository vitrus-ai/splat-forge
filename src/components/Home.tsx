import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FileUp, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RecentProject {
  path: string;
  name: string;
  sizeBytes: number;
  timestamp: number;
}

interface HomeProps {
  onMediaProject: () => void;
  onAiProject: () => void;
  onOpenExisting: () => void;
  recentProjects: RecentProject[];
  onOpenRecent: (path: string) => void;
  
  // New props for integrated project setup
  outputDir: string;
  onSelectOutputDir: () => void;
  projectName: string;
  onProjectNameChange: (val: string) => void;
  
  activeCreateTab: "files" | "ai";
  setActiveCreateTab: (tab: "files" | "ai") => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function Home({
  onMediaProject,
  onAiProject,
  onOpenExisting,
  recentProjects,
  onOpenRecent,
  outputDir,
  onSelectOutputDir,
  projectName,
  onProjectNameChange,
  activeCreateTab,
  setActiveCreateTab
}: HomeProps) {
  return (
    <div className="flex-1 flex flex-col md:flex-row p-8 max-w-6xl mx-auto w-full gap-16 relative z-10">
      {/* Left Column */}
      <div className="flex-1 flex flex-col gap-10 border-r border-amber-500/10 pr-12">
        {/* Create New Section */}

        <section className="flex flex-col gap-6 mt-4">
          <h2 className="text-sm font-medium text-amber-500/90 tracking-wider text-center">
            Create
          </h2>
          
          <div className="flex flex-col gap-5 border border-amber-500/20 bg-[#050505] p-6 rounded-md shadow-lg">
            {/* Tabs */}
            <div className="flex rounded-md p-1 bg-black/60 border border-amber-500/20 mx-auto w-fit">
              <Button
                type="button"
                variant={activeCreateTab === "files" ? "secondary" : "ghost"}
                onClick={() => setActiveCreateTab("files")}
                className={cn(
                  "px-6 h-8 rounded-sm text-xs font-medium transition-colors",
                  activeCreateTab === "files"
                    ? "bg-amber-900/40 text-amber-400 shadow-sm border border-amber-500/30"
                    : "text-amber-500/50 hover:text-amber-400 hover:bg-amber-500/10"
                )}
              >
                From Files
              </Button>
              <Button
                type="button"
                variant={activeCreateTab === "ai" ? "secondary" : "ghost"}
                onClick={() => setActiveCreateTab("ai")}
                className={cn(
                  "px-6 h-8 rounded-sm text-xs font-medium transition-colors",
                  activeCreateTab === "ai"
                    ? "bg-amber-900/40 text-amber-400 shadow-sm border border-amber-500/30"
                    : "text-amber-500/50 hover:text-amber-400 hover:bg-amber-500/10"
                )}
              >
                AI Generate
              </Button>
            </div>

            {/* Inputs */}
            <div className="flex flex-col gap-4 mt-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[14px] font-medium text-amber-200/90">Project Name</label>
                <p className="text-[10px] text-amber-500/50 mb-1">Output folder</p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={outputDir}
                    placeholder="Choose folder..."
                    className="font-mono text-xs border-amber-500/20 bg-black/40 h-9 text-amber-100"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={onSelectOutputDir}
                    className="shrink-0 h-9 w-9 border-amber-500/30 text-amber-400 hover:bg-amber-500/15"
                  >
                    <FolderOpen className="size-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-center mt-2">
              <Button 
                onClick={activeCreateTab === "files" ? onMediaProject : onAiProject}
                disabled={!outputDir}
                className={cn(
                  "h-10 px-8 text-[15px] font-medium rounded-sm border",
                  outputDir 
                    ? "bg-amber-900/30 text-amber-300 border-amber-500/40 hover:bg-amber-900/50 shadow-[0_0_15px_-3px_rgba(245,158,11,0.3)]"
                    : "bg-black/40 text-amber-500/30 border-amber-500/10 cursor-not-allowed"
                )}
              >
                🔥 Forge Splat
              </Button>
            </div>
          </div>
        </section>

        {/* Recent Projects Section */}
        <section className="flex flex-col gap-4">
          <h2 className="text-[14px] font-medium text-amber-400/90 tracking-wide">
            Recent Projects
          </h2>

          <div className="flex flex-col gap-3">
            {recentProjects.length === 0 ? (
              <div className="py-4 text-amber-500/50 text-[13px] italic font-light text-center border border-amber-500/10 rounded bg-[#050505]">
                No recent projects yet.
              </div>
            ) : (
              recentProjects.map((proj) => (
                <div
                  key={proj.path}
                  className="flex justify-between items-center py-3 border border-amber-500/20 bg-[#050505] cursor-pointer hover:bg-amber-900/10 px-4 rounded-md transition-all shadow-sm"
                  onClick={() => onOpenRecent(proj.path)}
                >
                  <div className="flex flex-col gap-1">
                    <span
                      className="text-amber-200/90 text-[13px] font-medium truncate max-w-[200px]"
                      title={proj.name}
                    >
                      {proj.name}
                    </span>
                    <span className="text-amber-500/50 text-[11px] font-mono">
                      {formatFileSize(proj.sizeBytes)}
                    </span>
                  </div>
                  <span className="text-amber-500/40 text-[11px]">
                    {timeAgo(proj.timestamp)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Right Column */}
      <div className="flex-1 flex flex-col gap-4 mt-4">
        <h2 className="text-sm font-medium text-amber-500/90 tracking-wider text-center mb-2">
          Open Splat
        </h2>
        <Card className="bg-[#050505]/40 border-amber-500/20 flex flex-col mt-0 shadow-lg">
          <CardContent className="flex-1 flex flex-col justify-center gap-6 p-8 py-10">
            <div className="flex flex-col gap-2">
              <h3 className="text-amber-200/90 font-medium text-[15px]">
                Open Existing
              </h3>
              <p className="text-amber-500/60 text-[12px] leading-relaxed">
                Click below or drag and drop an existing .splat or .ply file to
                preview, navigate, and edit.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={onOpenExisting}
              className="bg-[#0A0A0A]/80 border-amber-500/20 text-amber-200/90 hover:bg-amber-500/10 w-full h-32 flex flex-col gap-3 rounded-md mt-4 transition-all"
            >
              <FileUp className="size-6 opacity-80 text-amber-400" strokeWidth={1.5} />
              <span className="font-medium text-[13px] text-amber-200/80">
                Open or drop a Splat (.splat/.ply/.spz)
              </span>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
