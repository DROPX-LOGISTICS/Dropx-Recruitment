import { validateCreativeFile, type MetaMediaKind } from "./meta-media";

export type CreativePreview = { name: string; width: number; height: number; size: number; kind: MetaMediaKind; duration?: number; url: string };

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || (response.status === 413 ? "The upload is too large. Choose a smaller file." : "The creative upload failed. Please try again."));
  return data;
}

function mediaDetails(url: string, kind: MetaMediaKind) {
  return new Promise<{ width: number; height: number; duration?: number; thumbnail?: Blob }>((resolve, reject) => {
    const timeout = setTimeout(() => fail(new Error("The file could not be read. Try an H.264 MP4 with AAC audio.")), 15000);
    const done = (value: { width: number; height: number; duration?: number; thumbnail?: Blob }) => { clearTimeout(timeout); resolve(value); };
    const fail = (error: Error) => { clearTimeout(timeout); reject(error); };
    if (kind === "image") {
      const image = new Image();
      image.onload = () => done({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => fail(new Error("This image could not be read."));
      image.src = url;
      return;
    }
    const video = document.createElement("video");
    video.preload = "auto"; video.muted = true; video.playsInline = true;
    video.onerror = () => fail(new Error("This video cannot be played. Export an H.264 MP4 with AAC audio."));
    video.onloadeddata = () => {
      if (!Number.isFinite(video.duration) || video.duration < 1 || video.duration > 180) {
        fail(new Error("Use a video between 1 second and 3 minutes.")); return;
      }
      const width = video.videoWidth, height = video.videoHeight;
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1,1280/Math.max(width,height));
      canvas.width = Math.round(width*ratio); canvas.height = Math.round(height*ratio);
      canvas.getContext("2d")?.drawImage(video,0,0,canvas.width,canvas.height);
      canvas.toBlob(thumbnail => {
        if (!thumbnail) { fail(new Error("Could not prepare the video cover.")); return; }
        done({ width,height,duration:video.duration,thumbnail });
        video.removeAttribute("src"); video.load();
      },"image/jpeg",.9);
    };
    video.src = url;
  });
}

export async function uploadCreativeFile(input: {
  file: File; stream: string; headers: Record<string,string>; signal: AbortSignal;
  onPreview: (preview: CreativePreview) => void; onStatus: (message: string) => void;
}) {
  const { file, stream, headers, signal, onStatus } = input;
  const { kind, contentType } = validateCreativeFile(file);
  const localUrl = URL.createObjectURL(file);
  try {
    const details = await mediaDetails(localUrl, kind);
    if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
    if (details.width < 500 || details.height < 500) throw new Error("Use an image or video of at least 500 × 500 px.");
    input.onPreview({ name:file.name, size:file.size, kind, url:localUrl, ...details });
    const json = async (values: Record<string,unknown>) => responseJson(await fetch("/api/recruitment/meta-ad-builder/video", {
      method:"POST", headers:{...headers,"Content-Type":"application/json"}, body:JSON.stringify({stream,...values}), signal
    }));
    const data = new FormData(); data.append("stream",stream);
    data.append("file", kind === "video" ? details.thumbnail! : file, kind === "video" ? "video-cover.jpg" : file.name);
    onStatus(kind === "video" ? "Preparing the video cover…" : "Uploading image…");
    const image = await responseJson(await fetch("/api/recruitment/meta-ad-builder/media", { method:"POST",headers,body:data,signal }));
    if (!image.imageHash) throw new Error("The creative cover could not be saved.");
    if (kind === "image") return { ...image, kind, videoId: "" };
    onStatus("Uploading video…");
    const start = await json({ action:"start", fileName:file.name, contentType, size:file.size });
    // A short-lived signed URL carries only this file, never Recruit or Meta credentials.
    const storage = new FormData(); storage.append("cacheControl","3600");
    storage.append("",new Blob([file],{type:contentType}),file.name);
    await responseJson(await fetch(start.uploadUrl, { method:"PUT",body:storage,signal }));
    onStatus("Sending video to Meta…");
    const submitted = await json({ action:"complete",ticket:start.ticket });
    onStatus("Meta is processing the video…");
    const deadline = Date.now()+10*60*1000;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new DOMException("Upload cancelled","AbortError");
      const status = await json({ action:"status",ticket:submitted.ticket });
      if (status.ready) return { ...image,kind,videoId:submitted.videoId,videoUrl:status.videoUrl };
      await new Promise<void>((resolve,reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException("Upload cancelled","AbortError")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort",abort); resolve(); },4000);
        signal.addEventListener("abort",abort,{once:true});
      });
    }
    throw new Error("Meta is taking longer than expected to process this video. Try again later.");
  } catch (error) { URL.revokeObjectURL(localUrl); throw error; }
}
