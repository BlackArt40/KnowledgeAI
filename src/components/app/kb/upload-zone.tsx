"use client";

import * as React from "react";
import { UploadCloud, Link2, Loader2, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useChunkedUpload, CHUNKED_THRESHOLD } from "@/lib/upload/use-chunked-upload";

export function UploadZone({
  kbId,
  onUploaded,
}: {
  kbId: string;
  onUploaded: () => void;
}) {
  const [dragging, setDragging] = React.useState(false);
  const [mode, setMode] = React.useState<"file" | "link">("file");
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [pending, setPending] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const chunked = useChunkedUpload();
  const [chunkedFile, setChunkedFile] = React.useState<string | null>(null);

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setError(null);

    // Split into small (direct upload) and large (chunked upload) files
    const small = arr.filter((f) => f.size < CHUNKED_THRESHOLD);
    const large = arr.filter((f) => f.size >= CHUNKED_THRESHOLD);

    // ── Large files: chunked upload one by one ──────────────────
    for (const file of large) {
      setUploading(true);
      setChunkedFile(file.name);
      setProgress(0);
      const result = await chunked.upload(file, kbId);
      if (result === null) {
        if (chunked.state.status === "error") {
          setError(chunked.state.error ?? `${file.name} 上传失败`);
        }
        setUploading(false);
        setChunkedFile(null);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      setChunkedFile(null);
    }

    // ── Small files: batch direct upload ────────────────────────
    if (small.length > 0) {
      setUploading(true);
      setProgress(0);
      setPending(small.map((f) => f.name));
      const form = new FormData();
      small.forEach((f) => form.append("files", f));

      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else {
              try {
                const m = JSON.parse(xhr.responseText);
                reject(new Error(m.error ?? "上传失败"));
              } catch {
                reject(new Error("上传失败"));
              }
            }
          };
          xhr.onerror = () => reject(new Error("网络错误"));
          xhr.open("POST", `/api/knowledge-base/${kbId}/upload`);
          xhr.send(form);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
      } finally {
        setUploading(false);
        setProgress(0);
        setPending([]);
      }
    }

    onUploaded();
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    chunked.reset();
  }

  async function addLink() {
    if (!url.trim()) return;
    setError(null);
    setUploading(true);
    try {
      const res = await fetch(`/api/knowledge-base/${kbId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), name: url.trim() }),
      });
      if (!res.ok) {
        const m = await res.json().catch(() => ({}));
        throw new Error(m.error ?? "添加失败");
      }
      setUrl("");
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* mode switch */}
      <div className="flex w-fit rounded-lg border border-border bg-card p-1 text-sm">
        <button
          onClick={() => setMode("file")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors",
            mode === "file" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <UploadCloud className="h-3.5 w-3.5" /> 上传文件
        </button>
        <button
          onClick={() => setMode("link")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors",
            mode === "link" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Link2 className="h-3.5 w-3.5" /> 网页链接
        </button>
      </div>

      {mode === "file" ? (
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-primary/40 hover:bg-accent/40",
            uploading && "pointer-events-none opacity-80"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.doc,.docx,.md,.markdown,.txt,.csv"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">
                {chunkedFile
                  ? chunked.state.status === "completing"
                    ? `合并中… ${chunkedFile}`
                    : `分片上传… ${chunkedFile} ${chunked.state.progress}%`
                  : `上传中… ${progress}%`}
              </p>
              <div className="w-full max-w-xs">
                <Progress value={chunkedFile ? chunked.state.progress : progress} />
              </div>
              {chunkedFile ? (
                <p className="text-xs text-muted-foreground">
                  {chunked.state.receivedChunks}/{chunked.state.totalChunks} 分片
                  {chunked.state.status === "uploading" && " · 支持断点续传"}
                </p>
              ) : pending.length > 0 ? (
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {pending.join(", ")}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UploadCloud className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium">
                拖拽文件到此处，或<span className="text-primary">点击上传</span>
              </p>
              <p className="text-xs text-muted-foreground">
                支持 PDF / Word / Markdown / TXT / CSV · 大文件自动分片上传（≤ 500MB）
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="flex gap-2 rounded-xl border border-border bg-card p-3">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLink()}
            placeholder="https://example.com/article"
            className="flex-1"
          />
          <Button variant="gradient" onClick={addLink} disabled={uploading || !url.trim()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            添加
          </Button>
        </div>
      )}

      {error && (
        <p className="inline-flex items-center gap-1.5 text-xs text-destructive">
          <X className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}
