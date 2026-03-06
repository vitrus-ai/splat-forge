import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpen, Play, Video, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaProjectProps {
  onBack: () => void;
  inputPath: string;
  isVideo: boolean;
  outputDir: string;
  outputFilename: string;
  useDifix: boolean;
  onSelectVideo: () => void;
  onSelectImageFolder: () => void;
  onSelectOutputDir: () => void;
  onOutputFilenameChange: (val: string) => void;
  onUseDifixChange: (val: boolean) => void;
  useBgRemoval: boolean;
  onUseBgRemovalChange: (val: boolean) => void;
  onGenerate: () => void;
  canGenerate: boolean;
}

export function MediaProject({
  onBack,
  inputPath,
  isVideo,
  outputDir,
  outputFilename,
  useDifix,
  onSelectVideo,
  onSelectImageFolder,
  onSelectOutputDir,
  onOutputFilenameChange,
  onUseDifixChange,
  useBgRemoval,
  onUseBgRemovalChange,
  onGenerate,
  canGenerate,
}: MediaProjectProps) {
  return (
    <div className="flex-1 flex flex-col p-8 max-w-4xl mx-auto w-full relative z-10 h-full">
      <div className="flex items-center mb-12">
        <Button 
          variant="ghost" 
          onClick={onBack}
          className="text-amber-500/70 hover:text-amber-400 hover:bg-amber-500/10 px-2"
        >
          <ChevronLeft className="size-5 mr-1" />
          Back
        </Button>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-start pt-4">
        <div className="w-full max-w-md flex flex-col gap-6">
          <Card className="bg-black/40 border-amber-500/20 shadow-lg">
            <CardContent className="p-6 flex flex-col gap-5">
              {/* INPUT SECTION */}
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-amber-200/90 font-medium text-base mb-1">Source Media</h3>
                  <p className="text-xs text-amber-300/60 leading-relaxed">
                    Select the source material to construct your 3D Splat.
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div 
                    onClick={onSelectVideo}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-4 rounded-md border cursor-pointer transition-all",
                      isVideo && inputPath
                        ? "bg-amber-900/20 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.1)]" 
                        : "bg-black/60 border-amber-500/20 hover:bg-amber-900/10 hover:border-amber-500/30 text-amber-500/60"
                    )}
                  >
                    <Video className={cn("size-6", isVideo && inputPath ? "text-amber-400" : "")} />
                    <span className={cn("text-sm font-medium", isVideo && inputPath ? "text-amber-200" : "")}>Video File</span>
                    <span className="text-[10px] text-center opacity-70">.mp4, .mov</span>
                  </div>
                  
                  <div 
                    onClick={onSelectImageFolder}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-4 rounded-md border cursor-pointer transition-all",
                      !isVideo && inputPath
                        ? "bg-amber-900/20 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.1)]" 
                        : "bg-black/60 border-amber-500/20 hover:bg-amber-900/10 hover:border-amber-500/30 text-amber-500/60"
                    )}
                  >
                    <FolderOpen className={cn("size-6", !isVideo && inputPath ? "text-amber-400" : "")} />
                    <span className={cn("text-sm font-medium", !isVideo && inputPath ? "text-amber-200" : "")}>Images Folder</span>
                    <span className="text-[10px] text-center opacity-70">Folder of frames</span>
                  </div>
                </div>
                
                {inputPath && (
                  <div className="bg-black/40 p-2.5 rounded border border-amber-500/20 flex flex-col gap-1">
                    <span className="text-[10px] text-amber-500/70 uppercase tracking-wider font-semibold">Selected Path:</span>
                    <span className="text-xs text-amber-200/90 truncate font-mono" title={inputPath}>
                      {inputPath}
                    </span>
                  </div>
                )}
              </div>

              {/* PROCESSING OPTIONS */}
              <div className="flex flex-col gap-4 pt-5 border-t border-amber-500/10 mt-2">
                <h3 className="text-amber-200/90 font-medium text-base">Splat Processing Options</h3>
                
                <div className="flex flex-col gap-4 bg-black/20 p-3 rounded border border-amber-500/5">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="difix-toggle"
                      checked={useDifix}
                      onChange={(e) => onUseDifixChange(e.target.checked)}
                      className="accent-amber-500 w-4 h-4 mt-0.5"
                    />
                    <div className="flex flex-col">
                      <Label htmlFor="difix-toggle" className="text-sm text-amber-200/90 cursor-pointer font-medium">
                        Enable DNeRF+ enhancement
                      </Label>
                      <p className="text-[10px] text-amber-500/60 leading-relaxed mt-1 max-w-[320px]">
                        Uses a single-step diffusion model to clean up artifacts and floaters in novel views, distilling them back into the splat.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="bg-remove-toggle"
                      checked={useBgRemoval}
                      onChange={(e) => onUseBgRemovalChange(e.target.checked)}
                      className="accent-amber-500 w-4 h-4 mt-0.5"
                    />
                    <div className="flex flex-col">
                      <Label htmlFor="bg-remove-toggle" className="text-sm text-amber-200/90 cursor-pointer font-medium">
                        Remove Backgrounds
                      </Label>
                      <p className="text-[10px] text-amber-500/60 leading-relaxed mt-1 max-w-[320px]">
                        Removes the background from every frame using BiRefNet before training. Useful for isolated object scanning.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
</CardContent>
          </Card>
          
          <div className="fixed bottom-8 right-8 z-50">
            <Button
              type="button"
              size="lg"
              disabled={!canGenerate}
              onClick={onGenerate}
              className={cn(
                "h-14 px-8 font-semibold text-base shadow-xl backdrop-blur-md transition-all rounded-sm",
                canGenerate
                  ? "bg-amber-400 text-black hover:bg-amber-300 shadow-amber-500/20 hover:shadow-amber-500/40 hover:-translate-y-1"
                  : "bg-[#050505]/80 text-amber-500/30 border border-amber-500/20 cursor-not-allowed"
              )}
            >
              <Play className="size-5 mr-2" />
              Generate Splat
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
