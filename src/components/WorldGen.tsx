import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleGenAI } from '@google/genai';
import { cn } from "@/lib/utils";
import { Image as ImageIcon, Video, ArrowRight, Loader2, Play, ChevronLeft, FolderOpen, Edit2, X, Key } from "lucide-react";

interface WorldGenProps {
  outputFolder: string;
  projectName: string;
  onDatasetReady: (folderPath: string, options: { outputDir: string, outputFilename: string, useDifix: boolean, useBgRemoval: boolean }) => void;
  onBack: () => void;
}

interface VideoNode {
  id: string;
  instruction: string;
  prompt: string;
  status: "idle" | "generating" | "done" | "error";
  videoUrl?: string;
  localPath?: string;
  error?: string;
  selected: boolean;
}

const STATIC_SCENE_MODIFIER = "The environment is completely frozen and static. No humans, no people, no living creatures, no movement in the scene. Only the camera moves.";

const DEFAULT_CAMERA_MOVES = [
  { instruction: "Track forward", prompt: `Cinematic track forward. Slow, smooth camera movement forward into the scene. ${STATIC_SCENE_MODIFIER}` },
  { instruction: "Orbit left", prompt: `Cinematic orbit left around the central subject. Smooth, sweeping motion. ${STATIC_SCENE_MODIFIER}` },
  { instruction: "Orbit right", prompt: `Cinematic orbit right around the central subject. Smooth, sweeping motion. ${STATIC_SCENE_MODIFIER}` },
  { instruction: "Crane up", prompt: `Cinematic crane shot moving upwards while tilting down to keep the central subject in frame. ${STATIC_SCENE_MODIFIER}` },
];

export function WorldGen({ outputFolder, projectName, onDatasetReady, onBack }: WorldGenProps) {
  const [apiKey, setApiKey] = React.useState(() => localStorage.getItem("splatforge_gemini_api_key") || "");
  const [baseUrl, setBaseUrl] = React.useState(() => localStorage.getItem("splatforge_gemini_base_url") || "");
  
  // Output and Project name are provided by the parent Home component flow
  // outputFilename is also handled by parent but we might not need it here, we just pass the folder back
  const [useDifix, setUseDifix] = React.useState(true);
  const [useBgRemoval, setUseBgRemoval] = React.useState(false);
  
  const [referenceImage, setReferenceImage] = React.useState<string | null>(null);
  const [referencePrompt, setReferencePrompt] = React.useState("");
  const [isGeneratingImage, setIsGeneratingImage] = React.useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = React.useState(false);
  const [tempApiKey, setTempApiKey] = React.useState("");

  const [nodes, setNodes] = React.useState<VideoNode[]>(
    DEFAULT_CAMERA_MOVES.map((m, i) => ({
      id: `node-${i}`,
      instruction: m.instruction,
      prompt: m.prompt,
      status: "idle",
      selected: true,
    }))
  );

  const [isExtracting, setIsExtracting] = React.useState(false);
  const [isGeneratingVideos, setIsGeneratingVideos] = React.useState(false);
  const [expandedVideoUrl, setExpandedVideoUrl] = React.useState<string | null>(null);
  const [videosGenerated, setVideosGenerated] = React.useState(false);

  // Automatically switch layouts based on reference image presence
  const hasInitialFrame = !!referenceImage;



  const handleSelectImage = async () => {
    const selected = await tauriOpen({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (selected && !Array.isArray(selected)) {
      import("@tauri-apps/api/core").then(({ convertFileSrc }) => {
        setReferenceImage(convertFileSrc(selected));
      });
    }
  };

  const handleGenerateImage = async () => {
    if (!apiKey) return alert("Please set your Gemini/Vertex API Key first.");
    if (!referencePrompt) return alert("Please enter a prompt.");
    // outputFolder is guaranteed to exist via parent props
    
    setIsGeneratingImage(true);
    try {
      const ai = new GoogleGenAI({ 
        apiKey,
        apiVersion: 'v1alpha',
        httpOptions: baseUrl ? { baseUrl } : undefined
      });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: referencePrompt,
        config: {
          // @ts-ignore
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: "2K",
          },
        }
      });
      
      let base64 = "";
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            base64 = part.inlineData.data;
            break;
          }
        }
      }

      if (base64) {
        const imagePath = `${outputFolder}/${projectName}/references/generated_${Date.now()}.png`;
        await invoke("save_base64_file", { path: imagePath, base64Data: base64 });
        
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        setReferenceImage(convertFileSrc(imagePath));
      } else {
        throw new Error("No image data returned from API.");
      }
    } catch (e: any) {
      alert("Failed to generate image: " + (e?.message || String(e)));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const generateVideo = async (nodeId: string, promptText: string) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, status: "generating" } : n));
    
    try {
      const ai = new GoogleGenAI({ 
        apiKey,
        apiVersion: 'v1alpha',
        httpOptions: baseUrl ? { baseUrl } : undefined
      });

      let base64Image = null;
      if (referenceImage) {
        if (referenceImage.startsWith('data:')) {
          base64Image = referenceImage.split(',')[1];
        } else {
          const res = await fetch(referenceImage);
          const blob = await res.blob();
          base64Image = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(blob);
          });
        }
      }

      let operation = await ai.models.generateVideos({
        model: 'veo-2.0-generate-001',
        prompt: promptText,
        image: base64Image ? { imageBytes: base64Image, mimeType: "image/jpeg" } : undefined
      });
      
      if (!operation || !operation.name) throw new Error("No operation ID returned from API.");

      while (!operation.done) {
        await new Promise(r => setTimeout(r, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
        if (operation.error) throw new Error((operation.error.message as string) || JSON.stringify(operation.error));
      }
      
      let videoUrl = operation.response?.generatedVideos?.[0]?.video?.uri;
      let localVideoPath = "";
      
      if (videoUrl) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + `key=${apiKey}`;
        
        localVideoPath = `${outputFolder}/${projectName}/videos/video_${Date.now()}_${nodeId}.mp4`;
        await invoke("download_file", { url: videoUrl, path: localVideoPath });
        
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        videoUrl = convertFileSrc(localVideoPath);
      } else {
        throw new Error("No video URI returned in the response.");
      }
      
      setNodes(prev => prev.map(n => n.id === nodeId ? { 
        ...n, 
        status: "done", 
        videoUrl: videoUrl,
        localPath: localVideoPath
      } : n));
    } catch (e: any) {
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, status: "error", error: (e?.message || String(e)) } : n));
    }
  };

  const handleGenerateAll = async () => {
    if (!apiKey) return alert("Please set your Gemini/Vertex API Key first.");
    if (!referenceImage && !referencePrompt) return alert("Please provide a reference image or prompt.");
    // outputFolder is guaranteed to exist via parent props

    setIsGeneratingVideos(true);
    setVideosGenerated(true);

    const promises = nodes.map(node => {
      if (node.status === "idle" || node.status === "error") {
        return generateVideo(node.id, node.prompt);
      }
      return Promise.resolve();
    });

    await Promise.allSettled(promises);
    setIsGeneratingVideos(false);
  };

  const handleExtractFramesAndStart = async () => {
    const selectedVideos = nodes.filter(n => n.selected && n.status === "done" && (n.videoUrl || n.localPath));
    if (selectedVideos.length === 0) return alert("No completed videos selected.");

    setIsExtracting(true);
    try {
      const videoPaths = selectedVideos.map(n => n.localPath || n.videoUrl!); 
      
      const imagesDir = await invoke<string>("extract_multiple_videos", {
        videoPaths,
        outputDir: `${outputFolder}/${projectName}`
      });

      onDatasetReady(imagesDir, {
        outputDir: outputFolder,
        outputFilename: "", // handled by parent
        useDifix: useDifix,
        useBgRemoval: useBgRemoval
      });
    } catch (e) {
      alert("Failed to extract frames: " + String(e));
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-start min-h-0 relative z-10 w-full p-8 max-w-6xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center mb-8">
        <Button 
          variant="ghost" 
          onClick={onBack}
          className="text-amber-500/70 hover:text-amber-400 hover:bg-amber-500/10 px-2"
        >
          <ChevronLeft className="size-5 mr-1" />
          Back
        </Button>
      </div>

      {(!hasInitialFrame || !videosGenerated) ? (
        // STATE 1: INITIAL GENERATION
        <div className="flex flex-col items-center w-full">
          <div className="w-full max-w-xl flex flex-col gap-4 mt-2">
            
            <Card className="bg-black/0 border-amber-500/20 shadow-lg relative overflow-visible rounded-sm">
              
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex justify-between items-center mb-1">
                  <h2 className="text-amber-400 font-medium text-lg tracking-wide">Generate with Nano Banana 🍌</h2>
                  <Button 
                    type="button"
                    variant="outline" 
                    className={cn(
                      "h-8 px-4 text-xs font-medium rounded-sm transition-colors",
                      apiKey 
                        ? "bg-amber-900/10 border-amber-500/20 text-amber-500/60 hover:bg-amber-900/20" 
                        : "bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30"
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      setTempApiKey(apiKey);
                      setShowApiKeyModal(true);
                    }}
                  >
                    <Key className="size-3 mr-2 opacity-70" />
                    {apiKey ? "Gemini API Key Set" : "Set Gemini API Key"}
                  </Button>
                </div>
                
                <textarea 
                  placeholder="Describe the image to be generated" 
                  className="flex min-h-[60px] w-full rounded-sm border border-amber-500/20 bg-black/40 px-3 py-2 text-[14px] text-amber-100 placeholder:text-amber-600/40 focus-visible:outline-none focus-visible:border-amber-500/50 resize-none"
                  value={referencePrompt}
                  onChange={e => setReferencePrompt(e.target.value)}
                  disabled={isGeneratingImage}
                />

                <Button 
                  className="bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 self-start px-6 rounded-sm h-9 font-normal mt-1" 
                  onClick={handleGenerateImage}
                  disabled={isGeneratingImage || !referencePrompt}
                >
                  {isGeneratingImage ? <><Loader2 className="size-4 mr-2 animate-spin" /> Generating...</> : "Generate"}
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-black/0 border-amber-500/20 shadow-lg relative overflow-visible rounded-sm flex flex-col">
              <CardContent className="p-4 flex flex-col flex-1 gap-3">
                <h2 className="text-amber-400 font-medium text-lg tracking-wide mb-1">Initial Frame</h2>
                <p className="text-xs text-amber-500/60">The initial frame is used to generate the splat. You can generate with AI or upload your own.</p>
                {referenceImage ? (
                  <div className="relative group rounded-sm border border-amber-500/20 flex justify-center bg-black/20 overflow-hidden min-h-[150px] max-h-[350px]">
                    <img src={referenceImage} alt="Reference" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button variant="secondary" size="sm" onClick={() => setReferenceImage(null)}>Remove Image</Button>
                    </div>
                  </div>
                ) : (
                  <Button 
                    variant="outline" 
                    className="w-full h-32 border-dashed border-amber-500/20 hover:bg-amber-500/5 hover:border-amber-500/40 flex gap-3 justify-center items-center bg-black/20 rounded-sm" 
                    onClick={handleSelectImage}
                  >
                    <ImageIcon className="size-5 text-amber-500/80" />
                    <span className="text-[15px] text-amber-500/80 font-medium">Upload Initial Frame</span>
                  </Button>
                )}
              </CardContent>
            </Card>

            

            <div className="fixed bottom-8 right-8 z-50">
              <Button
                size="lg"
                className={cn(
                  "h-14 px-8 text-base font-semibold rounded-sm shadow-xl backdrop-blur-md transition-all",
                  referenceImage 
                    ? "bg-amber-400 text-black hover:bg-amber-300 shadow-amber-500/20 hover:shadow-amber-500/40 hover:-translate-y-1"
                    : "bg-[#050505]/80 text-amber-500/30 border border-amber-500/20 cursor-not-allowed"
                )}
                onClick={handleGenerateAll}
                disabled={!referenceImage}
              >
                Generate Videos
              </Button>
            </div>
          </div>
        </div>
      ) : (
        // STATE 2: VIDEOS GENERATION & OUTPUT
        <div className="flex flex-row items-start justify-center gap-10 max-w-full w-full mt-4">
          
          {/* Left: Initial Frame */}
          <Card className="w-64 bg-black/40 border-amber-500/20 shadow-lg relative overflow-visible shrink-0">
            <div className="absolute -top-3 left-4 bg-[#050508] px-2">
              <span className="text-amber-400 font-medium text-sm">Initial Frame</span>
            </div>
            <CardContent className="p-4 pt-6">
              <div className="relative rounded-lg overflow-hidden border border-amber-500/30 bg-black/60 aspect-video flex items-center justify-center">
                {referenceImage ? (
                  <img src={referenceImage} alt="Reference" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="size-8 text-amber-500/30" />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Middle: Lines */}
          <div className="relative w-16 h-[400px] shrink-0">
            {/* Horizontal line from initial frame to center vertical line */}
            <div className="absolute top-1/2 left-0 w-8 h-px bg-amber-500/40" />
            {/* Vertical line connecting all video nodes */}
            <div className="absolute top-[12.5%] bottom-[12.5%] left-8 w-px bg-amber-500/40" />
            {/* Horizontal lines to each video node */}
            {[12.5, 37.5, 62.5, 87.5].map(top => (
               <div key={top} className="absolute left-8 w-8 h-px bg-amber-500/40" style={{ top: `${top}%` }} />
            ))}
          </div>

          {/* Video Nodes list */}
          <div className="flex flex-col gap-4 shrink-0 h-[400px] justify-between">
            {nodes.map(node => (
              <div key={node.id} className="relative w-40 aspect-video bg-black/60 border border-amber-500/20 rounded-md overflow-hidden flex items-center justify-center group">
                {node.status === "idle" && <Video className="size-6 text-amber-500/20" />}
                {node.status === "generating" && (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-5 text-amber-500 animate-spin" />
                  </div>
                )}
                {node.status === "error" && (
                  <AlertCircle className="size-5 text-red-500/70" />
                )}
                {node.status === "done" && node.videoUrl && (
                  <div className="relative w-full h-full cursor-pointer group/vid" onClick={() => setExpandedVideoUrl(node.videoUrl!)}>
                    <video src={node.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/vid:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-xs font-semibold text-amber-300">View Full</span>
                    </div>
                  </div>
                )}
                
                {/* Node Instruction Label */}
                <div className="absolute top-1 left-2">
                  <span className="text-[10px] font-semibold text-amber-400/80 uppercase">{node.instruction}</span>
                </div>
                
                {/* Delete button (just visual for now, or deselects) */}
                <button 
                  className="absolute top-1 right-1 size-5 bg-black/60 rounded flex items-center justify-center text-amber-500/50 hover:text-red-400 transition-colors"
                  onClick={() => setNodes(prev => prev.map(n => n.id === node.id ? { ...n, selected: false } : n))}
                >
                  <X className="size-3" />
                </button>
                
                {/* Dark overlay if deselected */}
                {!node.selected && (
                  <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                    <span className="text-xs text-amber-500/50 font-medium">Skipped</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right: Output Options */}
          <div className="flex flex-col gap-6 ml-10 w-72 shrink-0">
            <Card className="bg-black/0 border-amber-500/20 shadow-lg relative overflow-visible rounded-sm">
              <div className="absolute -top-3 left-4 bg-[#050508] px-2">
                <span className="text-amber-400 font-medium text-sm">Processing Options</span>
              </div>
              <CardContent className="p-4 pt-6 flex flex-col gap-4">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={useDifix}
                    onChange={(e) => setUseDifix(e.target.checked)}
                    className="accent-amber-500 w-4 h-4 mt-0.5"
                  />
                  <div className="flex flex-col">
                    <Label className="text-sm text-amber-200/90 cursor-pointer font-medium">
                      Enable DNeRF+ Enhancement
                    </Label>
                    <p className="text-[10px] text-amber-500/60 leading-tight mt-1">
                      Distills floaters & artifacts in novel views back into the splat.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2 pt-2 border-t border-amber-500/10">
                  <input
                    type="checkbox"
                    checked={useBgRemoval}
                    onChange={(e) => setUseBgRemoval(e.target.checked)}
                    className="accent-amber-500 w-4 h-4 mt-0.5"
                  />
                  <div className="flex flex-col">
                    <Label className="text-sm text-amber-200/90 cursor-pointer font-medium">
                      Remove Backgrounds
                    </Label>
                    <p className="text-[10px] text-amber-500/60 leading-tight mt-1">
                      Isolates the subject by removing the background in every generated frame.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button
              size="lg"
              disabled={isGeneratingVideos || isExtracting || nodes.filter(n => n.selected && n.status === "done").length === 0}
              onClick={handleExtractFramesAndStart}
              className={cn(
                "w-full h-12 font-medium text-sm",
                (!isGeneratingVideos && !isExtracting && nodes.filter(n => n.selected && n.status === "done").length > 0)
                  ? "bg-amber-500 text-black hover:bg-amber-400 shadow-lg shadow-amber-500/25 border border-amber-400/50"
                  : "opacity-50 cursor-not-allowed bg-amber-900/40 text-amber-600 border border-amber-700/40"
              )}
            >
              {isExtracting ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Preparing...</>
              ) : isGeneratingVideos ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Generating Videos...</>
              ) : (
                <><Play className="size-4 mr-2" /> Generate Splat</>
              )}
            </Button>
          </div>

        </div>
      )}

    
      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <Card className="bg-[#050505] border border-amber-500/40 shadow-2xl w-full max-w-md">
            <CardContent className="p-6 flex flex-col gap-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-amber-400 flex items-center gap-2">
                  <Key className="size-5" />
                  Gemini API Key
                </h3>
                <button onClick={() => setShowApiKeyModal(false)} className="text-amber-500/50 hover:text-amber-400">
                  <X className="size-5" />
                </button>
              </div>
              
              <div className="flex flex-col gap-2">
                <p className="text-sm text-amber-100/70">
                  To generate images and videos, you need a Gemini API key. 
                </p>
                <a 
                  href="https://aistudio.google.com/api-keys" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-xs text-amber-500 hover:text-amber-300 underline underline-offset-2 flex items-center w-fit"
                >
                  Get your free API key at Google AI Studio
                </a>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-xs text-amber-500/70 uppercase tracking-wider">Your API Key</Label>
                <Input 
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="bg-black/60 border-amber-500/30 text-amber-100 font-mono"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setApiKey(tempApiKey);
                      localStorage.setItem("splatforge_gemini_api_key", tempApiKey);
                      setShowApiKeyModal(false);
                    }
                  }}
                />
              </div>

              <div className="flex justify-end gap-3 mt-2">
                <Button variant="outline" className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10" onClick={() => setShowApiKeyModal(false)}>
                  Cancel
                </Button>
                <Button 
                  className="bg-amber-500 text-black hover:bg-amber-400"
                  onClick={() => {
                    setApiKey(tempApiKey);
                    localStorage.setItem("splatforge_gemini_api_key", tempApiKey);
                    setShowApiKeyModal(false);
                  }}
                >
                  Save Key
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Video Expansion Modal */}
      {expandedVideoUrl && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md"
          onClick={() => setExpandedVideoUrl(null)}
        >
          <div className="relative max-w-4xl w-full p-4" onClick={e => e.stopPropagation()}>
            <button 
              className="absolute -top-10 right-4 text-amber-500/70 hover:text-amber-400"
              onClick={() => setExpandedVideoUrl(null)}
            >
              <X className="size-8" />
            </button>
            <div className="rounded-lg overflow-hidden border border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.2)] bg-black">
              <video src={expandedVideoUrl} autoPlay loop controls className="w-full h-auto max-h-[80vh]" />
            </div>
          </div>
        </div>
      )}
</div>
  );
}
